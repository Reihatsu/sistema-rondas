import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  MessageSquarePlus,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  Avatar,
  Badge,
  EmptyState,
  ErrorAlert,
  LogStatusBadge,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  cn,
} from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import {
  companiesApi,
  getErrorMessage,
  roundsApi,
  usersApi,
} from "../services/api";
import { formatDateTime, formatDuration } from "../utils/format";

const EMPTY_FILTERS = { company: "", guard: "", status: "", from: "", to: "" };
const PAGE_SIZE = 15;

const STATUS_OPTIONS = [
  { value: "", label: "Todos los estados" },
  { value: "PENDING", label: "Pendiente" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "PAUSED", label: "Pausada" },
  { value: "COMPLETED", label: "Finalizada" },
  { value: "CANCELLED", label: "Cancelada" },
];

export default function CompanyRounds() {
  const { hasRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    company: searchParams.get("company_id") || "",
    guard: searchParams.get("guard_id") || "",
    status: searchParams.get("status") || "",
  }));
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [guards, setGuards] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [commentRound, setCommentRound] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState("");

  const [detailRound, setDetailRound] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const isAdmin = hasRole("ADMIN");
  const canFilterCompany = hasRole("ADMIN", "SUPERVISOR", "COMPANY_USER");
  const canFilterGuard = hasRole("ADMIN", "SUPERVISOR");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const listParams = { page, page_size: PAGE_SIZE };
    const summaryParams = {};
    if (applied.company) {
      listParams.company_id = applied.company;
      summaryParams.company_id = applied.company;
    }
    if (applied.guard) listParams.guard_id = applied.guard;
    if (applied.status) listParams.status = applied.status;
    if (applied.from) {
      listParams.date_from = `${applied.from}T00:00:00`;
      summaryParams.date_from = listParams.date_from;
    }
    if (applied.to) {
      listParams.date_to = `${applied.to}T23:59:59`;
      summaryParams.date_to = listParams.date_to;
    }

    try {
      const [data, summaryData] = await Promise.all([
        roundsApi.list(listParams),
        roundsApi.summary(summaryParams),
      ]);
      setItems(data.items);
      setTotal(data.total);
      setSummary(summaryData);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [page, applied]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    companiesApi
      .listAll()
      .then((data) => {
        if (active) setCompanies(data);
      })
      .catch(() => {
        if (active) setCompanies([]);
      });

    if (canFilterGuard) {
      usersApi
        .listAll({ role: "GUARD" })
        .then((data) => {
          if (active) setGuards(data);
        })
        .catch(() => {
          if (active) setGuards([]);
        });
    }

    return () => {
      active = false;
    };
  }, [canFilterGuard]);

  const counts = useMemo(() => {
    const map = {};
    (summary?.by_status || []).forEach((entry) => {
      map[entry.status] = entry.count;
    });
    return map;
  }, [summary]);

  const selectedCompany = useMemo(
    () => companies.find((company) => String(company.id) === String(applied.company)),
    [companies, applied.company],
  );

  function syncUrl(next) {
    const query = {};
    if (next.company) query.company_id = next.company;
    if (next.guard) query.guard_id = next.guard;
    if (next.status) query.status = next.status;
    setSearchParams(query, { replace: true });
  }

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    const next = { ...filters };
    setPage(1);
    setApplied(next);
    syncUrl(next);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
    syncUrl(EMPTY_FILTERS);
  }

  function applyStatus(status) {
    const next = { ...applied, status };
    setFilters(next);
    setApplied(next);
    setPage(1);
    syncUrl(next);
  }

  function openComment(round) {
    setCommentRound(round);
    setCommentText("");
    setCommentError("");
  }

  async function submitComment(event) {
    event.preventDefault();
    if (!commentRound) return;
    setCommentBusy(true);
    setCommentError("");
    try {
      await roundsApi.addComment(commentRound.id, commentText.trim());
      setNotice(`Comentario añadido a la ronda #${commentRound.id}.`);
      setCommentRound(null);
      setCommentText("");
      await load();
      if (detailRound?.id === commentRound.id) {
        await openDetail(commentRound);
      }
    } catch (requestError) {
      setCommentError(getErrorMessage(requestError));
    } finally {
      setCommentBusy(false);
    }
  }

  async function openDetail(round) {
    setDetailRound(round);
    setDetailError("");
    setDetailLoading(true);
    try {
      const detail = await roundsApi.get(round.id);
      setDetailRound(detail);
    } catch (requestError) {
      setDetailError(getErrorMessage(requestError));
    } finally {
      setDetailLoading(false);
    }
  }

  const quickFilters = [
    {
      value: "",
      label: "Todas",
      count: summary?.total || 0,
      icon: ClipboardList,
      activeClass: "border-slate-300 bg-slate-100 text-slate-800",
    },
    {
      value: "COMPLETED",
      label: "Finalizadas",
      count: counts.COMPLETED || 0,
      icon: CheckCircle2,
      activeClass: "border-emerald-300 bg-emerald-50 text-emerald-800",
    },
    {
      value: "PAUSED",
      label: "Pausadas",
      count: counts.PAUSED || 0,
      icon: PauseCircle,
      activeClass: "border-amber-300 bg-amber-50 text-amber-800",
    },
    {
      value: "CANCELLED",
      label: "Canceladas",
      count: counts.CANCELLED || 0,
      icon: XCircle,
      activeClass: "border-red-300 bg-red-50 text-red-800",
    },
  ];


  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardList}
        title="Rondas de seguridad"
        description={
          selectedCompany
            ? `Histórico de ${selectedCompany.name} con trazabilidad de checkpoints NFC.`
            : isAdmin
              ? "Histórico global de rondas con trazabilidad de checkpoints NFC."
              : hasRole("GUARD")
                ? "Histórico de sus propias rondas con trazabilidad de checkpoints NFC."
                : "Histórico de rondas de las empresas asignadas a su usuario."
        }
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              aria-hidden="true"
            />
            Actualizar
          </button>
        }
      />

      <Notice tone="success" onClose={() => setNotice("")}>
        {notice}
      </Notice>
      <ErrorAlert message={error} onRetry={load} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="stat-card">
          <p className="stat-label">Total de rondas</p>
          <div className="flex items-end justify-between gap-2">
            <p className="stat-value">{summary?.total ?? 0}</p>
            <ClipboardList className="h-5 w-5 text-odoo-400" aria-hidden="true" />
          </div>
        </div>
        <div className="stat-card border-emerald-100">
          <p className="stat-label">Finalizadas</p>
          <div className="flex items-end justify-between gap-2">
            <p className="stat-value text-emerald-700">{counts.COMPLETED || 0}</p>
            <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          </div>
        </div>
        <div className="stat-card border-amber-100">
          <p className="stat-label">Pausadas</p>
          <div className="flex items-end justify-between gap-2">
            <p className="stat-value text-amber-700">{counts.PAUSED || 0}</p>
            <PauseCircle className="h-5 w-5 text-amber-400" aria-hidden="true" />
          </div>
        </div>
        <div className="stat-card border-red-100">
          <p className="stat-label">Canceladas</p>
          <div className="flex items-end justify-between gap-2">
            <p className="stat-value text-red-700">{counts.CANCELLED || 0}</p>
            <XCircle className="h-5 w-5 text-red-400" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">

        <div className="toolbar">
          <form
            className="flex w-full flex-wrap items-end gap-2"
            onSubmit={applyFilters}
          >
            {canFilterCompany ? (
              <div className="min-w-[180px] flex-1 sm:max-w-[240px]">
                <label htmlFor="round-company" className="label">
                  Empresa
                </label>
                <select
                  id="round-company"
                  name="company"
                  value={filters.company}
                  onChange={handleFilterChange}
                  className="select"
                >
                  <option value="">Todas las empresas</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                      {company.is_active ? "" : " (inactiva)"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {canFilterGuard ? (
              <div className="min-w-[170px] flex-1 sm:max-w-[220px]">
                <label htmlFor="round-guard" className="label">
                  Guardia
                </label>
                <select
                  id="round-guard"
                  name="guard"
                  value={filters.guard}
                  onChange={handleFilterChange}
                  className="select"
                >
                  <option value="">Todos los guardias</option>
                  {guards.map((guard) => (
                    <option key={guard.id} value={guard.id}>
                      {guard.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="min-w-[150px] flex-1 sm:max-w-[190px]">
              <label htmlFor="round-status" className="label">
                Estado
              </label>
              <select
                id="round-status"
                name="status"
                value={filters.status}
                onChange={handleFilterChange}
                className="select"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[135px] flex-1 sm:max-w-[160px]">
              <label htmlFor="round-from" className="label">
                Desde
              </label>
              <input
                id="round-from"
                type="date"
                name="from"
                value={filters.from}
                max={filters.to || undefined}
                onChange={handleFilterChange}
                className="input"
              />
            </div>

            <div className="min-w-[135px] flex-1 sm:max-w-[160px]">
              <label htmlFor="round-to" className="label">
                Hasta
              </label>
              <input
                id="round-to"
                type="date"
                name="to"
                value={filters.to}
                min={filters.from || undefined}
                onChange={handleFilterChange}
                className="input"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button type="submit" className="btn btn-primary btn-sm">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                Filtrar
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={resetFilters}
                title="Limpiar filtros"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Limpiar
              </button>
            </div>
          </form>


          <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Filtros rápidos
            </span>
            {quickFilters.map((quick) => {
              const Icon = quick.icon;
              const active = applied.status === quick.value;
              return (
                <button
                  key={quick.value || "all"}
                  type="button"
                  onClick={() => applyStatus(quick.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                    active
                      ? quick.activeClass
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {quick.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px]",
                      active ? "bg-white/70" : "bg-slate-100",
                    )}
                  >
                    {quick.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>


        {loading ? (
          <Spinner label="Cargando rondas…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Sin rondas"
            description="No hay rondas que coincidan con los filtros seleccionados."
            action={
              applied.status || applied.company || applied.guard || applied.from || applied.to ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Limpiar filtros
                </button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="table-scroll hidden md:block">
              <table className="data-table min-w-[1080px]">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Empresa</th>
                    <th>Guardia</th>
                    <th>Fecha/Hora inicio</th>
                    <th>Fecha/Hora fin</th>
                    <th>Estado</th>
                    <th>Observaciones</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((round) => (
                    <tr key={round.id}>
                      <td className="font-mono text-xs text-slate-400">#{round.id}</td>
                      <td>
                        <p className="max-w-[180px] truncate text-xs font-medium text-slate-700">
                          {round.company?.name || `Empresa ${round.company_id}`}
                        </p>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={round.guard?.name || "?"} size="sm" />
                          <div className="min-w-0">
                            <p className="max-w-[160px] truncate text-xs font-semibold text-slate-800">
                              {round.guard?.name || `Usuario ${round.guard_id}`}
                            </p>
                            <p className="max-w-[160px] truncate text-[10px] text-slate-400">
                              {round.guard?.email || ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {formatDateTime(round.start_time || round.created_at)}
                        <p className="text-[10px] text-slate-400">
                          {formatDuration(round.start_time, round.end_time)}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {formatDateTime(round.end_time)}
                      </td>
                      <td>
                        <StatusBadge status={round.status} />
                      </td>
                      <td>
                        {round.observations ? (
                          <p
                            className="line-clamp-2 max-w-[280px] whitespace-pre-line break-words text-xs text-slate-600"
                            title={round.observations}
                          >
                            {round.observations}
                          </p>
                        ) : (
                          <span className="text-xs text-slate-400">Sin observaciones</span>
                        )}
                      </td>
                      <td className="cell-actions">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => openComment(round)}
                            title="Agregar comentario"
                            aria-label={`Agregar comentario a la ronda ${round.id}`}
                          >
                            <MessageSquarePlus
                              className="h-4 w-4 text-odoo-600"
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => openDetail(round)}
                            title="Ver detalle y checkpoints"
                            aria-label={`Ver detalle de la ronda ${round.id}`}
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>


            <div className="divide-y divide-slate-100 md:hidden">
              {items.map((round) => (
                <article key={round.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={round.guard?.name || "?"} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {round.guard?.name || `Usuario ${round.guard_id}`}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {round.company?.name || `Empresa ${round.company_id}`}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={round.status} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 px-3 py-2 text-[11px]">
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">
                        Inicio
                      </p>
                      <p className="mt-0.5 text-slate-700">
                        {formatDateTime(round.start_time || round.created_at)}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">
                        Fin
                      </p>
                      <p className="mt-0.5 text-slate-700">
                        {formatDateTime(round.end_time)}
                      </p>
                    </div>
                  </div>

                  <p className="line-clamp-3 whitespace-pre-line break-words text-xs text-slate-600">
                    {round.observations || "Sin observaciones"}
                  </p>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm flex-1"
                      onClick={() => openComment(round)}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Comentar
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm flex-1"
                      onClick={() => openDetail(round)}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      Detalle
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
      </div>


      {commentRound ? (
        <Modal
          icon={MessageSquarePlus}
          title={`Comentario · Ronda #${commentRound.id}`}
          subtitle={`${commentRound.guard?.name || "Guardia"} · ${
            commentRound.company?.name || `Empresa ${commentRound.company_id}`
          }`}
          onClose={() => {
            if (!commentBusy) setCommentRound(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCommentRound(null)}
                disabled={commentBusy}
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="comment-form"
                className="btn btn-primary"
                disabled={commentBusy}
              >
                {commentBusy ? "Guardando…" : "Agregar comentario"}
              </button>
            </>
          }
        >
          <form id="comment-form" className="space-y-4" onSubmit={submitComment}>
            <ErrorAlert message={commentError} />

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <StatusBadge status={commentRound.status} />
              <span>
                Inicio:{" "}
                <strong className="font-semibold text-slate-800">
                  {formatDateTime(commentRound.start_time || commentRound.created_at)}
                </strong>
              </span>
              <span>
                Fin:{" "}
                <strong className="font-semibold text-slate-800">
                  {formatDateTime(commentRound.end_time)}
                </strong>
              </span>
            </div>

            {commentRound.observations ? (
              <div>
                <p className="label">Observaciones actuales</p>
                <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  {commentRound.observations}
                </div>
              </div>
            ) : null}

            <div>
              <label htmlFor="round-comment" className="label">
                Nuevo comentario *
              </label>
              <textarea
                id="round-comment"
                required
                minLength={2}
                maxLength={1000}
                autoFocus
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                className="textarea"
                placeholder="Describa una incidencia, una novedad o una nota operativa…"
              />
              <p className="field-hint">
                El comentario se añadirá a las observaciones con su nombre y la
                fecha/hora actual. {commentText.length}/1000 caracteres.
              </p>
            </div>
          </form>
        </Modal>
      ) : null}


      {detailRound ? (
        <Modal
          wide
          icon={ClipboardList}
          title={`Ronda #${detailRound.id}`}
          subtitle={`${detailRound.guard?.name || "Guardia"} · ${
            detailRound.company?.name || `Empresa ${detailRound.company_id}`
          }`}
          onClose={() => setDetailRound(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openComment(detailRound)}
              >
                <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                Agregar comentario
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDetailRound(null)}
              >
                Cerrar
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <ErrorAlert message={detailError} />

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Estado
                </p>
                <div className="mt-1">
                  <StatusBadge status={detailRound.status} />
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Inicio
                </p>
                <p className="mt-1 text-xs font-medium text-slate-700">
                  {formatDateTime(detailRound.start_time || detailRound.created_at)}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Fin
                </p>
                <p className="mt-1 text-xs font-medium text-slate-700">
                  {formatDateTime(detailRound.end_time)}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Duración
                </p>
                <p className="mt-1 text-xs font-medium text-slate-700">
                  {formatDuration(detailRound.start_time, detailRound.end_time)}
                </p>
              </div>
            </div>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">
                Observaciones
              </h3>
              <div className="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                {detailRound.observations || "Sin observaciones registradas."}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Trazabilidad NFC
                </h3>
                <Badge tone="purple">
                  {(detailRound.logs || []).length} checkpoint
                  {(detailRound.logs || []).length === 1 ? "" : "s"}
                </Badge>
              </div>

              {detailLoading ? (
                <Spinner label="Cargando checkpoints…" className="py-6" />
              ) : (detailRound.logs || []).length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500">
                  Esta ronda no tiene lecturas NFC registradas.
                </div>
              ) : (
                <ol className="relative ml-1 space-y-4 border-l border-slate-200 pl-5">
                  {detailRound.logs.map((log) => (
                    <li key={log.id} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white",
                          log.status === "OK" && "bg-emerald-500",
                          log.status === "INCIDENT" && "bg-red-500",
                          log.status === "SKIPPED" && "bg-amber-500",
                        )}
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">
                            {log.checkpoint_name}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">
                            NFC: {log.nfc_tag_id}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {formatDateTime(log.timestamp)}
                          </p>
                        </div>
                        <LogStatusBadge status={log.status} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

