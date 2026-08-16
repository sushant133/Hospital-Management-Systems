import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dicomApi } from '../../../api/dicomApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, PageHeader, Spinner, Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'study', label: 'Study' },
  { key: 'patient', label: 'Patient' },
  { key: 'modality', label: 'Modality' },
  { key: 'instances', label: 'Instances' },
  { key: 'when', label: 'Stored' },
  { key: 'files', label: '' },
];

export function DicomPage() {
  const { can } = useAuth();
  const canUpload = can(MODULES.DICOM, 'create');
  const canDownload = can(MODULES.DICOM, 'download');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await dicomApi.list({ limit: 100 });
      setRows(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const response = await dicomApi.upload(file);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="DICOM studies"
        description="Hospital-side store of imaging instances. Not a PACS — modalities (or a bridge) POST files here."
        action={
          canUpload && (
            <label className="inline-flex cursor-pointer">
              <input type="file" accept=".dcm,.dicom,application/dicom" className="hidden" onChange={onFile} disabled={uploading} />
              <span className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                {uploading ? 'Uploading…' : 'Upload .dcm'}
              </span>
            </label>
          )
        }
      />

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      {loading ? <Spinner label="Loading studies…" className="py-12" /> : (
        <Table>
          <THead columns={COLUMNS} />
          <TBody>
            {rows.length === 0 && (
              <TRMessage colSpan={COLUMNS.length}>No studies stored yet.</TRMessage>
            )}
            {rows.map((study) => (
              <TR key={study._id}>
                <TD>
                  <div className="font-mono text-xs text-slate-500">{study.studyInstanceUid}</div>
                  <div className="text-sm text-slate-900">{study.studyDescription || 'Untitled study'}</div>
                  {study.accessionNumber && (
                    <div className="text-xs text-slate-400">Acc {study.accessionNumber}</div>
                  )}
                </TD>
                <TD>
                  {study.patientId ? (
                    <Link to={`/patients/${study.patientId._id}`} className="text-brand-600">
                      {fullName(study.patientId)}
                    </Link>
                  ) : (
                    study.patientName || study.patientMrnHint || '—'
                  )}
                </TD>
                <TD><Badge tone="info">{study.modality || '—'}</Badge></TD>
                <TD>{study.instanceCount ?? study.instances?.length ?? 0}</TD>
                <TD className="whitespace-nowrap text-xs">{formatDate(study.createdAt, { withTime: true })}</TD>
                <TD>
                  {canDownload && (study.instances ?? []).map((inst) => (
                    <a
                      key={inst._id}
                      href={dicomApi.instanceUrl(study._id, inst._id)}
                      className="mr-2 text-xs text-brand-600 hover:underline"
                    >
                      {inst.filename || 'download'}
                    </a>
                  ))}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export default DicomPage;
