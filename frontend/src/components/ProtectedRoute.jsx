import { useEffect } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, ShieldX } from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS, homeForRole } from "../utils/format";

/** Protege rutas privadas y, opcionalmente, limita el acceso por rol. */
export default function ProtectedRoute({ roles, children }) {
  const { isAuthenticated, initializing, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) return undefined;
    const handleUnauthorized = () => navigate("/login", { replace: true });
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () =>
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, [isAuthenticated, navigate]);

  if (initializing) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 text-sm text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin text-odoo-700" aria-hidden="true" />
        <p>Cargando sesión…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (roles && user && !roles.includes(user.role)) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="card p-6 text-center">
          <span className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600">
            <ShieldX className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-semibold text-slate-900">Acceso restringido</h1>
          <p className="mt-2 text-sm text-slate-500">
            Su rol <strong className="font-semibold text-slate-700">{ROLE_LABELS[user.role] || user.role}</strong>{" "}
            no tiene permisos para ver esta sección.
          </p>
          <Link
            to={homeForRole(user.role)}
            className="btn btn-primary mt-5"
            replace
          >
            Ir a mi panel
          </Link>
        </div>
      </div>
    );
  }

  return children;
}
