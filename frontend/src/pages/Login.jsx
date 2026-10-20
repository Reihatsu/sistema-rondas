import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  ShieldHalf,
  UsersRound,
} from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { getErrorMessage } from "../services/api";
import { homeForRole } from "../utils/format";

const DEMO_ACCOUNTS = [
  {
    role: "Administrador",
    email: "admin@demo.com",
    password: "admin123",
    tone: "bg-odoo-50 text-odoo-700 border-odoo-200",
  },
  {
    role: "Supervisor",
    email: "supervisor@demo.com",
    password: "super123",
    tone: "bg-sky-50 text-sky-700 border-sky-200",
  },
  {
    role: "Guardia",
    email: "guardia1@demo.com",
    password: "guardia123",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    role: "Empresa",
    email: "cliente@demo.com",
    password: "cliente123",
    tone: "bg-amber-50 text-amber-700 border-amber-200",
  },
];

export default function Login() {
  const { login, isAuthenticated, initializing, user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Iniciar sesión · Sistema de Rondas";
  }, []);

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-odoo-700" aria-hidden="true" />
        Cargando sesión…
      </div>
    );
  }

  if (isAuthenticated && user) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const profile = await login(email.trim(), password);
      navigate(homeForRole(profile.role), { replace: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(account) {
    setEmail(account.email);
    setPassword(account.password);
    setError("");
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <section className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-odoo-950 p-10 text-white lg:flex xl:p-14">
        <div
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-odoo-600/30 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-odoo-400/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          aria-hidden="true"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-odoo-600 shadow-lg">
            <ShieldHalf className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-base font-bold tracking-tight">Sistema de Rondas</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-odoo-200/70">
              Control de vigilancia
            </p>
          </div>
        </div>

        <div className="relative max-w-lg">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-odoo-100">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Plataforma de operaciones de seguridad
          </p>
          <h1 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
            Supervise sus rondas con trazabilidad de extremo a extremo.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-odoo-100/75">
            Centralice empresas, guardias y checkpoints NFC en un panel claro,
            diseñado para equipos operativos que necesitan decisiones rápidas.
          </p>

          <ul className="mt-8 space-y-4 text-sm">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10">
                <ClipboardCheck className="h-4 w-4 text-odoo-100" aria-hidden="true" />
              </span>
              <span>
                <strong className="block font-semibold">Rondas en tiempo real</strong>
                <span className="text-odoo-100/65">
                  Estados, observaciones y bitácora NFC en una sola vista.
                </span>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10">
                <UsersRound className="h-4 w-4 text-odoo-100" aria-hidden="true" />
              </span>
              <span>
                <strong className="block font-semibold">Equipos organizados</strong>
                <span className="text-odoo-100/65">
                  Supervisores y guardias agrupados por empresa e instalación.
                </span>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10">
                <ShieldCheck className="h-4 w-4 text-odoo-100" aria-hidden="true" />
              </span>
              <span>
                <strong className="block font-semibold">Acceso por rol</strong>
                <span className="text-odoo-100/65">
                  Cada usuario ve únicamente la información que le corresponde.
                </span>
              </span>
            </li>
          </ul>
        </div>

        <p className="relative text-[11px] text-odoo-200/40">
          © {new Date().getFullYear()} Sistema de Rondas · Pulmahue Sa
        </p>
      </section>


      <section className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-odoo-700 text-white">
              <ShieldHalf className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">Sistema de Rondas</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                Control de vigilancia
              </p>
            </div>
          </div>

          <div className="card p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                Iniciar sesión
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Acceda con sus credenciales corporativas.
              </p>
            </div>

            {error ? (
              <div
                className="mb-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="login-email" className="label">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="usuario@empresa.com"
                    className="input pl-9"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="label">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="input pl-9 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Verificando…
                  </>
                ) : (
                  <>
                    Entrar al panel
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </form>


            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <CheckCircle2 className="h-3.5 w-3.5 text-odoo-600" aria-hidden="true" />
                Cuentas de demostración
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => fillDemo(account)}
                    className={`rounded-md border px-2 py-1.5 text-left text-[11px] leading-tight transition hover:brightness-[0.98] ${account.tone}`}
                    title={`${account.email} / ${account.password}`}
                  >
                    <span className="block font-semibold">{account.role}</span>
                    <span className="block truncate opacity-75">{account.email}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-slate-400">
                Haga clic en una cuenta para rellenar el formulario. Disponibles
                solo en entornos de demostración.
              </p>
            </div>
          </div>

          <p className="mt-5 text-center text-[11px] text-slate-400">
            ¿Problemas para acceder? Contacte con su administrador.
          </p>
        </div>
      </section>
    </div>
  );
}

