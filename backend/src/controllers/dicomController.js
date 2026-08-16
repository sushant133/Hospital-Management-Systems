import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DicomStudy, Patient, RadiologyOrder } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';
import { parseDicomFile } from '../services/dicomReader.js';
import { resolveUploadPath, uploadsRoot } from '../services/pdfService.js';

const POPULATE = [
  { path: 'patientId', select: 'mrn firstName lastName dateOfBirth gender' },
  { path: 'radiologyOrderId', select: 'orderNumber accessionNumber status modality' },
];

export const listStudies = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({
    ...query,
    sort: query.sort || '-createdAt',
  });
  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.radiologyOrderId ? { radiologyOrderId: query.radiologyOrderId } : null,
    query.modality ? { modality: query.modality } : null,
    query.accessionNumber ? { accessionNumber: query.accessionNumber } : null,
  );
  const [rows, total] = await Promise.all([
    DicomStudy.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    DicomStudy.countDocuments(filter),
  ]);
  return sendResponse(res, { data: rows, meta: buildMeta({ page, limit, total }) });
});

export const getStudy = asyncHandler(async (req, res) => {
  const row = await DicomStudy.findById(req.params.id).populate(POPULATE);
  if (!row) throw ApiError.notFound('DICOM study not found');
  return sendResponse(res, { data: row });
});

export const uploadInstance = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.buffer) {
    throw ApiError.badRequest('Attach a DICOM file as "file"', { code: 'NO_FILES' });
  }

  const tmpName = `incoming-${crypto.randomBytes(8).toString('hex')}.dcm`;
  const tmpDir = path.join(uploadsRoot(), 'dicom', '_tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, tmpName);
  await fs.promises.writeFile(tmpPath, file.buffer);

  const header = parseDicomFile(tmpPath);
  const studyUid =
    header.studyInstanceUid ||
    `2.25.${crypto.randomBytes(12).toString('hex').replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10))}`;
  const sopUid = header.sopInstanceUid || `inst-${crypto.randomBytes(8).toString('hex')}`;
  const safeStudy = studyUid.replace(/[^0-9.]/g, '_');
  const safeSop = sopUid.replace(/[^0-9a-zA-Z.]/g, '_');

  const destDir = path.join(uploadsRoot(), 'dicom', safeStudy);
  await fs.promises.mkdir(destDir, { recursive: true });
  const destName = `${safeSop}.dcm`;
  const destPath = path.join(destDir, destName);
  await fs.promises.rename(tmpPath, destPath).catch(async () => {
    await fs.promises.copyFile(tmpPath, destPath);
    await fs.promises.unlink(tmpPath).catch(() => {});
  });

  const relativePath = path.posix.join('dicom', safeStudy, destName);

  let patientId = req.body.patientId || null;
  if (!patientId && header.patientId) {
    const match = await Patient.findOne({
      $or: [{ mrn: header.patientId }, { nationalId: header.patientId }],
      isActive: true,
    })
      .select('_id')
      .lean();
    if (match) patientId = match._id;
  }

  let radiologyOrderId = req.body.radiologyOrderId || null;
  if (!radiologyOrderId && header.accessionNumber) {
    const order = await RadiologyOrder.findOne({
      orderNumber: header.accessionNumber,
      isActive: true,
    })
      .select('_id patientId')
      .lean();
    if (order) {
      radiologyOrderId = order._id;
      if (!patientId) patientId = order.patientId;
    }
  }

  let study = await DicomStudy.findOne({ studyInstanceUid: studyUid });
  if (!study) {
    study = await DicomStudy.create({
      studyInstanceUid: studyUid,
      accessionNumber: header.accessionNumber || '',
      patientId,
      radiologyOrderId,
      patientName: header.patientName || '',
      patientMrnHint: header.patientId || '',
      modality: header.modality || '',
      studyDate: header.studyDate || '',
      studyDescription: header.studyDescription || '',
      instances: [],
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
  } else {
    if (patientId && !study.patientId) study.patientId = patientId;
    if (radiologyOrderId && !study.radiologyOrderId) study.radiologyOrderId = radiologyOrderId;
    if (header.modality && !study.modality) study.modality = header.modality;
    if (header.studyDescription && !study.studyDescription) study.studyDescription = header.studyDescription;
    if (header.accessionNumber && !study.accessionNumber) study.accessionNumber = header.accessionNumber;
    study.updatedBy = req.user._id;
  }

  const already = study.instances.find((inst) => inst.sopInstanceUid === sopUid);
  if (already) {
    already.path = relativePath;
    already.filename = file.originalname || destName;
    already.sizeBytes = file.size;
    already.uploadedAt = new Date();
  } else {
    study.instances.push({
      sopInstanceUid: sopUid,
      seriesInstanceUid: header.seriesInstanceUid || '',
      instanceNumber: header.instanceNumber ? Number(header.instanceNumber) : null,
      path: relativePath,
      filename: file.originalname || destName,
      sizeBytes: file.size,
    });
  }

  await study.save();
  await study.populate(POPULATE);

  return sendCreated(res, {
    message: already ? 'Instance replaced' : `Stored instance on study ${studyUid}`,
    data: { study, header, parsed: header.parsed !== false },
  });
});

export const downloadInstance = asyncHandler(async (req, res) => {
  const study = await DicomStudy.findById(req.params.id);
  if (!study) throw ApiError.notFound('DICOM study not found');
  const instance = study.instances.id(req.params.instanceId);
  if (!instance) throw ApiError.notFound('Instance not found');

  const absolute = resolveUploadPath(instance.path);
  if (!fs.existsSync(absolute)) {
    throw ApiError.notFound('Stored file is missing');
  }
  res.setHeader('Content-Type', 'application/dicom');
  res.setHeader('Content-Disposition', `attachment; filename="${instance.filename || 'study.dcm'}"`);
  return res.sendFile(absolute);
});
