import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import RequireAdmin from "./components/RequireAdmin";
import RequireWorkspaceUser from "./components/RequireWorkspaceUser";
import AppLayout from "./layouts/AppLayout";
import AdminHome from "./pages/AdminHome";
import AdminLogin from "./pages/AdminLogin";
import Chats from "./pages/Chats";
import Dashboard from "./pages/Dashboard";
import EmbeddedChatbot from "./pages/EmbeddedChatbot";
import Integrations from "./pages/Integrations";
import Inquiries from "./pages/Inquiries";
import Knowledgebase from "./pages/Knowledgebase";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import Support from "./pages/Support";
import TestBot from "./pages/TestBot";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/embed/chatbot" element={<EmbeddedChatbot />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminHome />
            </RequireAdmin>
          }
        />
        <Route
          element={
            <RequireWorkspaceUser>
              <AppLayout />
            </RequireWorkspaceUser>
          }
        >
          <Route path="/" element={<Navigate replace to="/dashboard" />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/knowledgebase" element={<Knowledgebase />} />
          <Route path="/test-bot" element={<TestBot />} />
          <Route
            path="/inquiries"
            element={<Inquiries />}
          />
          <Route
            path="/settings"
            element={<Settings />}
          />
          <Route
            path="/support"
            element={<Support />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
