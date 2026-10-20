import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
} from "lucide-react";

import {
  LOG_STATUS_LABELS,
  LOG_STATUS_TONES,
  STATUS_LABELS,
  STATUS_TONES,
} from "../utils/format";

export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const BADGE_TONES = {
  neutral: "badge-neutral",
  purple: "badge-purple",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
};

/** Etiqueta de color reutilizable. */
export function Badge({ tone = "neutral", children, className = "" }) {
  return (
    <span className={cn("badge", BADGE_TONES[tone] || BADGE_TONES.neutral, className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  return (
    <Badge tone={STATUS_TONES[status] || "neutral"}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "COMPLETED" && "bg-emerald-500",
          status === "PAUSED" && "bg-amber-500",
          status === "CANCELLED" && "bg-red-500",
          status === "IN_PROGRESS" && "bg-sky-500",
          status === "PENDING" && "bg-slate-400",
          !status && "bg-slate-400",
        )}
        aria-hidden="true"
      />
      {STATUS_LABELS[status] || status}
    </Badge>
  );
}

export function LogStatusBadge({ status }) {
  return (
    <Badge tone={LOG_STATUS_TONES[status] || "neutral"}>
      {LOG_STATUS_LABELS[status] || status}
    </Badge>
  );
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Avatar({ name, size = "md", className = "" }) {
  const sizes = {
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-odoo-100 font-bold text-odoo-700 ring-1 ring-odoo-200",
        sizes[size] || sizes.md,
        className,
      )}
      aria-hidden="true"
    >
      {initials(name) || "?"}
    </span>
  );
}

export function Spinner({ label = "Cargando…", className = "" }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-12 text-sm text-slate-500",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin text-odoo-600" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title = "Sin datos",
  description,
  action,
  className = "",
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {Icon ? (
          <Icon className="h-6 w-6" aria-hidden="true" />
        ) : (
          <Info className="h-6 w-6" aria-hidden="true" />
        )}
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorAlert({ message, onRetry }) {
  if (!message) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
      role="alert"
    >
      <span className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </span>
      {onRetry ? (
        <button
          type="button"
          className="btn btn-sm border border-red-300 bg-white text-red-700 hover:bg-red-100"
          onClick={onRetry}
        >
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

const NOTICE_STYLES = {
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
};

export function Notice({ tone = "info", children, onClose }) {
  if (!children) return null;
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "danger" || tone === "warning"
        ? AlertTriangle
        : Info;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-md border px-3.5 py-2.5 text-sm",
        NOTICE_STYLES[tone] || NOTICE_STYLES.info,
      )}
      role="status"
    >
      <span className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{children}</span>
      </span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 opacity-70 hover:opacity-100"
          aria-label="Cerrar aviso"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:px-5">
      <span>
        Mostrando{" "}
        <strong className="font-semibold text-slate-700">
          {from}–{to}
        </strong>{" "}
        de <strong className="font-semibold text-slate-700">{total}</strong> registros
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="btn btn-secondary btn-sm disabled:opacity-40"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
        >
          Anterior
        </button>
        <span className="px-2 py-1 text-slate-500">
          Página <strong className="font-semibold text-slate-700">{page}</strong> de{" "}
          {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm disabled:opacity-40"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  footer,
  wide = false,
}) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cn("modal-panel", wide && "modal-panel-wide")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div className="flex min-w-0 items-start gap-3">
            {Icon ? (
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-odoo-50 text-odoo-700">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {subtitle ? (
                <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="topbar-action -mr-1 -mt-1"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title = "Confirmar acción",
  description,
  confirmLabel = "Confirmar",
  tone = "danger",
  busy = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={cn("btn", tone === "danger" ? "btn-danger" : "btn-primary")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{description}</p>
    </Modal>
  );
}

export function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-odoo-700 text-white shadow-sm sm:inline-flex">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

