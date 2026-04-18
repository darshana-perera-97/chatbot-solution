import { Navigate, useLocation } from "react-router-dom";
import { getWorkspaceUserId } from "../auth/userSession";

function RequireWorkspaceUser({ children }) {
  const location = useLocation();
  const userId = getWorkspaceUserId();

  if (!userId) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default RequireWorkspaceUser;
