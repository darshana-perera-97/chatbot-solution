import { Navigate, useLocation } from "react-router-dom";
import { isAdminAuthenticated } from "../auth/adminSession";

function RequireAdmin({ children }) {
  const location = useLocation();

  if (!isAdminAuthenticated()) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default RequireAdmin;
