import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  ClipboardList,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  Avatar,
  Badge,
  EmptyState,
  ErrorAlert,
  PageHeader,
  Spinner,
  cn,
} from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { getErrorMessage, usersApi } from "../services/api";

export default function SupervisorView() {
  const { user } = useAuth();
  const [guards, setGuards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await usersApi.listAll({ role: "GUARD" });
      setGuards(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return guards;
    return guards.filter(
      (guard) =>
        guard.name.toLowerCase().includes(term) ||
        guard.email.toLowerCase().includes(term),
    );
  }, [guards, search]);

  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((guard) => {
      const assigned =
        guard.companies && guard.companies.length > 0
          ? guard.companies
          : [{ id: 0, name: "Sin empresa asignada", tax_id: "—" }];
      assigned.forEach((company) => {
        if (!map.has(company.id)) {
          map.set(company.id, { company, guards: [] });
        }
        map.get(company.id).guards.push(guard);
      });
    });
    return [...map.values()].sort((a, b) =>
      a.company.name.localeCompare(b.company.name),
    );
  }, [filtered]);

  const uniqueCompanies = useMemo(() => {
    const ids = new Set();
    guards.forEach((guard) => {
      (guard.companies || []).forEach((company) => ids.add(company.id));
    });
    return ids.size;
  }, [guards]);

  const activeCount = guards.filter((guard) => guard.is_active).length;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShieldCheck}
        title="Guardias"
        description={`Equipo asignado a la supervisión de ${user?.name || "su usuario"}, agrupado por empresa.`}
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

      <ErrorAlert message={error} onRetry={load} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="stat-card">
          <p className="stat-label">Guardias asignados</p>
          <div className="flex items-end justify-between gap-2">
            <p className="stat-value">{guards.length}</p>
            <UsersRound className="h-5 w-5 text-odoo-400" aria-hidden="true" />
          </div>
        </div>
        <div className="stat-card">
          <p className="stat-label">Guardias activos</p>
          <div className="flex items-end justify-between gap-2">
            <p className="stat-value text-emerald-700">{activeCount}</p>
            <UserCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          </div>
        </div>
        <div className="stat-card">
          <p className="stat-label">Empresas cubiertas</p>
          <div className="flex items-end justify-between gap-2">
            <p className="stat-value">{uniqueCompanies}</p>
            <Building2 className="h-5 w-5 text-sky-400" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="toolbar">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar guardia por nombre o correo…"
              className="input pl-9"
              aria-label="Buscar guardias"
            />
          </div>
          <span className="text-xs text-slate-500">
            {filtered.length} de {guards.length} guardias
          </span>
        </div>

        {loading ? (
          <Spinner label="Cargando guardias…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={guards.length === 0 ? "Sin guardias asignados" : "Sin resultados"}
            description={
              guards.length === 0
                ? "Todavía no tiene guardias a cargo. Solicite a un administrador que le asigne su equipo."
                : "Ningún guardia coincide con la búsqueda introducida."
            }
          />
        ) : (
          <div className="space-y-4 p-4 sm:p-5">
            {groups.map(({ company, guards: companyGuards }) => (
              <section
                key={company.id}
                className="overflow-hidden rounded-lg border border-slate-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-odoo-50/60 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-odoo-700 ring-1 ring-odoo-200">
                      <Building2 className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {company.name}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {company.tax_id}
                      </p>
                    </div>
                  </div>
                  <Badge tone="purple">
                    {companyGuards.length} guardia
                    {companyGuards.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                <div className="grid gap-2.5 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  {companyGuards.map((guard) => (
                    <article
                      key={guard.id}
                      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3.5 transition hover:border-odoo-300 hover:shadow-sm"
                    >
                      <div className="flex items-start gap-2.5">
                        <Avatar name={guard.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {guard.name}
                          </p>
                          <p className="flex items-center gap-1 truncate text-[11px] text-slate-500">
                            <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{guard.email}</span>
                          </p>
                        </div>
                        <Badge tone={guard.is_active ? "success" : "neutral"}>
                          {guard.is_active ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>

                      <Link
                        to={
                          company.id
                            ? `/rondas?company_id=${company.id}&guard_id=${guard.id}`
                            : `/rondas?guard_id=${guard.id}`
                        }
                        className="btn btn-secondary btn-sm w-full"
                      >
                        <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                        Ver rondas
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

