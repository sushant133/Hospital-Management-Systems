import { api, ApiRequestError } from './client.js';

async function uploadFile(file, fields = {}) {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) {
    if (value) form.append(key, value);
  }

  const response = await fetch('/api/v1/dicom/studies', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiRequestError(error.message || `Request failed (${response.status})`, {
      status: response.status,
      code: error.code,
      details: error.details,
    });
  }
  return payload;
}

export const dicomApi = {
  list: (params) => api.get('/dicom/studies', { params }),
  get: (id) => api.get(`/dicom/studies/${id}`),
  upload: (file, fields) => uploadFile(file, fields),
  instanceUrl: (studyId, instanceId) => `/api/v1/dicom/studies/${studyId}/instances/${instanceId}`,
};

export default dicomApi;
