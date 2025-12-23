// src/components/ui/Input.tsx
import { type ReactNode, type InputHTMLAttributes, useId } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
  containerClassName?: string;
}

export function Input({
  label,
  error,
  hint,
  icon,
  containerClassName = '',
  className = '',
  id,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id || autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;

  const inputClassName = `input-soft ${error ? 'border-danger' : ''} ${className}`.trim();

  return (
    <div className={containerClassName}>
      {label && (
        <label htmlFor={inputId} className="label-muted block mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">{icon}</div>}
        <input
          id={inputId}
          className={icon ? `${inputClassName} pl-10` : inputClassName}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={errorId || hintId}
          {...props}
        />
      </div>
      {error && (
        <span id={errorId} className="text-sm text-danger mt-1 block">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={hintId} className="text-sm text-muted mt-1 block">
          {hint}
        </span>
      )}
    </div>
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
  rows?: number;
}

export function Textarea({
  label,
  error,
  hint,
  containerClassName = '',
  className = '',
  id,
  rows = 4,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const textareaId = id || autoId;
  const errorId = error ? `${textareaId}-error` : undefined;
  const hintId = hint ? `${textareaId}-hint` : undefined;

  const textareaClassName = `input-soft resize-y ${error ? 'border-danger' : ''} ${className}`.trim();

  return (
    <div className={containerClassName}>
      {label && (
        <label htmlFor={textareaId} className="label-muted block mb-2">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        className={textareaClassName}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId || hintId}
        {...props}
      />
      {error && (
        <span id={errorId} className="text-sm text-danger mt-1 block">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={hintId} className="text-sm text-muted mt-1 block">
          {hint}
        </span>
      )}
    </div>
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
  children: ReactNode;
}

export function Select({
  label,
  error,
  hint,
  containerClassName = '',
  className = '',
  id,
  children,
  ...props
}: SelectProps) {
  const autoId = useId();
  const selectId = id || autoId;
  const errorId = error ? `${selectId}-error` : undefined;
  const hintId = hint ? `${selectId}-hint` : undefined;

  const selectClassName = `input-soft ${error ? 'border-danger' : ''} ${className}`.trim();

  return (
    <div className={containerClassName}>
      {label && (
        <label htmlFor={selectId} className="label-muted block mb-2">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={selectClassName}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId || hintId}
        {...props}
      >
        {children}
      </select>
      {error && (
        <span id={errorId} className="text-sm text-danger mt-1 block">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={hintId} className="text-sm text-muted mt-1 block">
          {hint}
        </span>
      )}
    </div>
  );
}

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: ReactNode;
}

export function Label({ htmlFor, children, className = '', ...props }: LabelProps) {
  return (
    <label htmlFor={htmlFor} className={`label-muted ${className}`.trim()} {...props}>
      {children}
    </label>
  );
}
