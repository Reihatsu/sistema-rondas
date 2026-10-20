import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import OdooLayout from "./layouts/OdooLayout";
import Checkpoints from "./pages/Checkpoints";
import Companies from "./pages/Companies";
import CompanyRounds from "./pages/CompanyRounds";
import Login from "./pages/Login";
import SupervisorView from "./pages/SupervisorView";
import Users from "./pages/Users";
import { homeForRole } from "./utils/format";

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homeForRole(user?.role)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <OdooLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route
          path="empresas"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <Companies />
            </ProtectedRoute>
          }
        />
        <Route
          path="usuarios"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="guardias"
          element={
            <ProtectedRoute roles={["SUPERVISOR"]}>
              <SupervisorView />
            </ProtectedRoute>
          }
        />
        <Route
          path="puntos-control"
          element={
            <ProtectedRoute roles={["ADMIN", "SUPERVISOR", "COMPANY_USER"]}>
              <Checkpoints />
            </ProtectedRoute>
          }
        />
        <Route
          path="rondas"
          element={
            <ProtectedRoute roles={["ADMIN", "SUPERVISOR", "COMPANY_USER", "GUARD"]}>
              <CompanyRounds />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
