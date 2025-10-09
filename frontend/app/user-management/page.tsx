"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FiSearch,
  FiTrash2,
  FiRefreshCw,
  FiUsers,
  FiList,
  FiFileText,
} from "react-icons/fi";
import CreateInviteModal from "./components/CreateInviteModal";

/* ===========================
   TYPE DEFINITIONS
=========================== */
type User = {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  role: string | null;
  isActivated: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserLog = {
  id: number;
  userId?: number | null;
  username?: string | null;
  action: string;
  userAgent?: string | null;
  createdAt: string;
};

type UserProfile = {
  id: string;
  plan: string;
  price: number;
  companyName: string;
  fullName: string;
  city: string;
  country: string;
  email?: string | null;
  createdAt: string;
  userId?: string | null;
};

/* ===========================
   MAIN COMPONENT
=========================== */
export default function UserManagementPage() {
  const [view, setView] = useState<"users" | "logs" | "profiles">("users");
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [errorUsers, setErrorUsers] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string | null>(null);
  const [errorProfiles, setErrorProfiles] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const API_BASE = "http://localhost:3001";

  /* ===========================
     FETCH FUNCTIONS
  =========================== */
  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      setErrorUsers(null);
      const res = await fetch(`${API_BASE}/api/user`);
      if (!res.ok) throw new Error(`Failed to fetch users (${res.status})`);
      const data: User[] = await res.json();
      setUsers(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch users";
      setErrorUsers(message);
    } finally {
      setLoadingUsers(false);
    }
  }, [API_BASE]);

  const fetchLogs = useCallback(async () => {
    try {
      setLoadingLogs(true);
      setErrorLogs(null);
      const res = await fetch(`${API_BASE}/api/user-logs`);
      if (!res.ok) throw new Error(`Failed to fetch logs (${res.status})`);
      const data: UserLog[] = await res.json();
      setLogs(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch logs";
      setErrorLogs(message);
    } finally {
      setLoadingLogs(false);
    }
  }, [API_BASE]);

  const fetchProfiles = useCallback(async () => {
    try {
      setLoadingProfiles(true);
      setErrorProfiles(null);
      const res = await fetch(`${API_BASE}/api/subscription-profiles`);
      if (!res.ok) throw new Error(`Failed to fetch profiles (${res.status})`);
      const data: UserProfile[] = await res.json();
      setProfiles(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch profiles";
      setErrorProfiles(message);
    } finally {
      setLoadingProfiles(false);
    }
  }, [API_BASE]);

  /* ===========================
     AUTO REFRESH LOGS
  =========================== */
  useEffect(() => {
    fetchUsers();
    fetchLogs();
    fetchProfiles();

    let iv: ReturnType<typeof setInterval> | null = null;
    if (view === "logs") {
      iv = setInterval(fetchLogs, 10_000);
    }
    return () => {
      if (iv) clearInterval(iv);
    };
  }, [fetchUsers, fetchLogs, fetchProfiles, view]);

  /* ===========================
     DELETE USER
  =========================== */
  const handleDeleteUser = async (id: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/user/${id}`, { method: "DELETE" });
      if (res.ok) {
        alert("User deleted successfully");
        fetchUsers();
      } else {
        const errData = await res.json();
        alert("Failed to delete user: " + (errData?.error || "unknown"));
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting user");
    }
  };

  /* ===========================
     SEARCH FILTER
  =========================== */
  const q = search.toLowerCase();
  const filteredUsers = users.filter(
    (u) =>
      (u.name?.toLowerCase().includes(q) ?? false) ||
      (u.email?.toLowerCase().includes(q) ?? false) ||
      (u.username?.toLowerCase().includes(q) ?? false)
  );
  const filteredLogs = logs.filter(
    (l) =>
      (l.username?.toLowerCase().includes(q) ?? false) ||
      l.action.toLowerCase().includes(q)
  );
  const filteredProfiles = profiles.filter(
    (p) =>
      p.companyName.toLowerCase().includes(q) ||
      p.fullName.toLowerCase().includes(q) ||
      p.city.toLowerCase().includes(q) ||
      p.country.toLowerCase().includes(q)
  );

  /* ===========================
     RENDER
  =========================== */
  return (
    <div className="min-h-screen bg-[#0D1B2A] text-white flex">
      {/* Sidebar */}
      <nav className="w-56 bg-[#0D1B2A] p-4 flex flex-col gap-4">
        <h2 className="text-lg font-semibold mb-4">Management</h2>

        <button
          className={`flex items-center gap-2 px-3 py-2 rounded font-medium text-sm ${
            view === "users" ? "bg-[#1E4DB7]" : "hover:bg-[#1E3C72]"
          }`}
          onClick={() => setView("users")}
        >
          <FiUsers size={18} />
          User Management
        </button>

        <button
          className={`flex items-center gap-2 px-3 py-2 rounded font-medium text-sm ${
            view === "logs" ? "bg-[#1E4DB7]" : "hover:bg-[#1E3C72]"
          }`}
          onClick={() => setView("logs")}
        >
          <FiList size={18} />
          Log Management
        </button>

        <button
          className={`flex items-center gap-2 px-3 py-2 rounded font-medium text-sm ${
            view === "profiles" ? "bg-[#1E4DB7]" : "hover:bg-[#1E3C72]"
          }`}
          onClick={() => setView("profiles")}
        >
          <FiFileText size={18} />
          Subscription
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto">
        <header className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-xl font-semibold">
            {view === "users"
              ? "User Management"
              : view === "logs"
              ? "User Logs"
              : "Subscription Profiles"}
          </h1>

          {/* Header Buttons */}
          {view === "users" && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-[#1E4DB7] px-5 py-2 rounded text-white font-medium text-sm"
              >
                Invite User
              </button>

              <button
                onClick={() => {
                  fetchUsers();
                  fetchLogs();
                  fetchProfiles();
                }}
                title="Refresh"
                className="bg-[#132132] p-2 rounded"
              >
                <FiRefreshCw />
              </button>
            </div>
          )}

          {view === "logs" && (
            <button
              onClick={fetchLogs}
              title="Refresh Logs"
              className="bg-[#132132] p-2 rounded"
            >
              <FiRefreshCw />
            </button>
          )}

          {view === "profiles" && (
            <button
              onClick={fetchProfiles}
              title="Refresh Profiles"
              className="bg-[#132132] p-2 rounded"
            >
              <FiRefreshCw />
            </button>
          )}
        </header>

        {/* Search */}
        <div className="mb-4 max-w-md relative">
          <FiSearch className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder={`Search ${
              view === "users" ? "users" : view === "logs" ? "logs" : "profiles"
            }...`}
            className="w-full rounded pl-10 pr-3 py-2 bg-[#132132] placeholder-gray-400 text-white outline-none text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Tables */}
        {view === "users" && (
          <UserTable
            users={filteredUsers}
            loading={loadingUsers}
            error={errorUsers}
            onDelete={handleDeleteUser}
          />
        )}
        {view === "logs" && (
          <LogTable logs={filteredLogs} loading={loadingLogs} error={errorLogs} />
        )}
        {view === "profiles" && (
          <ProfileTable
            profiles={filteredProfiles}
            loading={loadingProfiles}
            error={errorProfiles}
          />
        )}

        <CreateInviteModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </main>
    </div>
  );
}

/* ===========================
   SUB COMPONENTS
=========================== */

function UserTable({
  users,
  loading,
  error,
  onDelete,
}: {
  users: User[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => void;
}) {
  if (error) return <div className="p-4 text-red-400">Error: {error}</div>;

  return (
    <div className="overflow-auto rounded-lg border border-[#1C2C3A] bg-[#0C1A2A]">
      <table className="min-w-full text-sm">
        <thead className="bg-[#030E1C] text-white sticky top-0">
          <tr>
            <th className="px-4 py-2 text-left">Name</th>
            <th className="px-4 py-2 text-left">Email</th>
            <th className="px-4 py-2 text-left">Username</th>
            <th className="px-4 py-2 text-left">Role</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Created</th>
            <th className="px-4 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="py-8 text-center text-gray-400 italic">
                Loading users...
              </td>
            </tr>
          ) : users.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-8 text-center text-gray-400 italic">
                No users found.
              </td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id} className="border-t border-[#1C2C3A] hover:bg-[#334155]">
                <td className="px-4 py-2">{u.name || "-"}</td>
                <td className="px-4 py-2">{u.email || "-"}</td>
                <td className="px-4 py-2">{u.username || "-"}</td>
                <td className="px-4 py-2 capitalize">{u.role || "-"}</td>
                <td className="px-4 py-2">{u.isActivated ? "Active" : "Inactive"}</td>
                <td className="px-4 py-2">{new Date(u.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => onDelete(u.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <FiTrash2 />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function LogTable({
  logs,
  loading,
  error,
}: {
  logs: UserLog[];
  loading: boolean;
  error: string | null;
}) {
  if (error) return <div className="p-4 text-red-400">Error: {error}</div>;
  return (
    <div className="overflow-auto rounded-lg border border-[#1C2C3A] bg-[#0C1A2A]">
      <table className="min-w-full text-sm">
        <thead className="bg-[#030E1C] text-white sticky top-0">
          <tr>
            <th className="px-4 py-2 text-left">Username</th>
            <th className="px-4 py-2 text-left">Action</th>
            <th className="px-4 py-2 text-left">User Agent</th>
            <th className="px-4 py-2 text-left">Time</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={4} className="py-8 text-center text-gray-400 italic">
                Loading logs...
              </td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-8 text-center text-gray-400 italic">
                No logs found.
              </td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id} className="border-t border-[#1C2C3A] hover:bg-[#334155]">
                <td className="px-4 py-2">{log.username || "-"}</td>
                <td className="px-4 py-2">{log.action}</td>
                <td className="px-4 py-2 text-xs">{log.userAgent || "-"}</td>
                <td className="px-4 py-2">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ProfileTable({
  profiles,
  loading,
  error,
}: {
  profiles: UserProfile[];
  loading: boolean;
  error: string | null;
}) {
  if (error) return <div className="p-4 text-red-400">Error: {error}</div>;
  return (
    <div className="overflow-auto rounded-lg border border-[#1C2C3A] bg-[#0C1A2A]">
      <table className="min-w-full text-sm">
        <thead className="bg-[#030E1C] text-white sticky top-0">
          <tr>
            <th className="px-4 py-2 text-left">Company</th>
            <th className="px-4 py-2 text-left">Full Name</th>
            <th className="px-4 py-2 text-left">Email</th>
            <th className="px-4 py-2 text-left">Plan</th>
            <th className="px-4 py-2 text-left">Price</th>
            <th className="px-4 py-2 text-left">City</th>
            <th className="px-4 py-2 text-left">Country</th>
            <th className="px-4 py-2 text-left">Created</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} className="py-8 text-center text-gray-400 italic">
                Loading profiles...
              </td>
            </tr>
          ) : profiles.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-8 text-center text-gray-400 italic">
                No profiles found.
              </td>
            </tr>
          ) : (
            profiles.map((p) => (
              <tr key={p.id} className="border-t border-[#1C2C3A] hover:bg-[#334155]">
                <td className="px-4 py-2">{p.companyName}</td>
                <td className="px-4 py-2">{p.fullName}</td>
                <td className="px-4 py-2">{p.email || "-"}</td>
                <td className="px-4 py-2">{p.plan}</td>
                <td className="px-4 py-2">Rp{p.price.toLocaleString()}</td>
                <td className="px-4 py-2">{p.city}</td>
                <td className="px-4 py-2">{p.country}</td>
                <td className="px-4 py-2">
                  {new Date(p.createdAt).toLocaleString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
