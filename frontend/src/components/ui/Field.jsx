import { useId } from 'react';

/**
 * Label + control + error wrapper. `error` is the message string returned by
 * the API's validation `details`, keyed by field name.
 */
export function Field({ label, error, required, hint, htmlFor, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label className="form-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ label, error, required, hint, className = '', ...props }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  return (
    <Field label={label} error={error} required={required} hint={hint} htmlFor={id} className={className}>
      <input
        id={id}
        className={['form-control', error ? 'form-control-error' : ''].join(' ')}
        aria-invalid={Boolean(error)}
        {...props}
      />
    </Field>
  );
}

export function Select({
  label,
  error,
  required,
  hint,
  options = [],
  placeholder,
  className = '',
  children,
  ...props
}) {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  return (
    <Field label={label} error={error} required={required} hint={hint} htmlFor={id} className={className}>
      <select
        id={id}
        className={['form-control', error ? 'form-control-error' : ''].join(' ')}
        aria-invalid={Boolean(error)}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
    </Field>
  );
}

export function Textarea({ label, error, required, hint, rows = 3, className = '', ...props }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  return (
    <Field label={label} error={error} required={required} hint={hint} htmlFor={id} className={className}>
      <textarea
        id={id}
        rows={rows}
        className={['form-control', error ? 'form-control-error' : ''].join(' ')}
        aria-invalid={Boolean(error)}
        {...props}
      />
    </Field>
  );
}

export default Field;
