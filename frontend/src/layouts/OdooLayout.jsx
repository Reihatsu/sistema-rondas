import { useEffect, useState } from "react";
import {
  Building2,
  ChevronRight,
  ClipboardList,
  LogOut,
  MapPin,
  Menu,
  ShieldCheck,
  ShieldHalf,
  UsersRound,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { Avatar, cn } from "../components/ui";
import { ROLE_LABELS } from "../utils/format";

const NAV_ITEMS = [
  {
    to: "/empresas",
    label: "Empresas",
    icon: Building2,
    roles: ["ADMIN"],
  },
  {
    to: "/usuarios",
    label: "Usuarios",
    icon: UsersRound,
    roles: ["ADMIN"],
  },
  {
    to: "/rondas",
    label: "Rondas",
    icon: ClipboardList,
    roles: ["ADMIN", "SUPERVISOR", "COMPANY_USER", "GUARD"],
  },
  {
    to: "/guardias",
    label: "Guardias",
    icon: ShieldCheck,
    roles: ["SUPERVISOR"],
  },
  {
    to: "/puntos-control",
    label: "Puntos de Control",
    icon: MapPin,
    roles: ["ADMIN", "SUPERVISOR", "COMPANY_USER"],
  },
];

export default function OdooLayout() {
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || hasRole(...item.roles),
  );
  const currentItem = NAV_ITEMS.find((item) => location.pathname === item.to);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.title = `${currentItem?.label || "Panel"} · Sistema de Rondas`;
  }, [currentItem?.label]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[1px] lg:hidden"
          aria-label="Cerrar menú"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-odoo-950 text-white shadow-2xl transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shadow-none",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between gap-3 border-b border-white/10 px-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-odoo-600 text-white shadow-inner">
              <ShieldHalf className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold tracking-tight">
                Sistema de Rondas
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-odoo-200/70">
                Control de vigilancia
              </span>
            </span>
          </NavLink>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-odoo-100/80 hover:bg-white/10 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menú"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-odoo-200/50">
          Aplicaciones
        </div>
        <nav
          className="flex-1 space-y-1 overflow-y-auto px-3 py-2"
          aria-label="Navegación principal"
        >
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  cn("nav-item", isActive && "nav-item-active")
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Avatar
              name={user?.name}
              size="sm"
              className="bg-white/10 text-white ring-white/20"
            />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{user?.name}</p>
              <p className="truncate text-[10px] text-odoo-200/70">
                {ROLE_LABELS[user?.role] || user?.role}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[10px] text-odoo-200/40">
            Sistema de Rondas · v1.0
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="topbar-action lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="hidden text-slate-400 sm:inline">Inicio</span>
              <ChevronRight
                className="hidden h-3.5 w-3.5 text-slate-300 sm:inline"
                aria-hidden="true"
              />
              <span className="truncate font-semibold text-slate-800">
                {currentItem?.label || "Panel"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2.5 rounded-md border border-slate-200 bg-slate-50 py-1 pl-1 pr-3 sm:flex">
              <Avatar name={user?.name} size="sm" />
              <div className="min-w-0 leading-tight">
                <p className="max-w-[160px] truncate text-xs font-semibold text-slate-800">
                  {user?.name}
                </p>
                <p className="text-[10px] text-slate-500">
                  {ROLE_LABELS[user?.role] || user?.role}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="btn btn-secondary btn-sm"
              title="Cerrar sesión"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden xs:inline">Salir</span>
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

