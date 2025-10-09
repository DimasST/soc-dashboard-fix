'use client';

import React from "react";
import { useEffect, useState } from 'react';
import AddDeviceForm from './components/AddDevice';
import AddAgentForm from './components/AddAgent';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Pencil,
  Trash2,
  Plus,
  BarChart2,
} from 'lucide-react';

type Device = {
  prtgId: string;
  id: string;
  name: string;
  host: string;
  status: number;
};

type WazuhAgent = {
  id: string;
  agentId: string;
  name: string;
  ip: string;
  status: string;
  os: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/+$/, '') ||
  'http://localhost:3001';

export default function DevicePage() {
  const [activeTab, setActiveTab] = useState<'prtg' | 'wazuh'>('prtg');

  // PRTG state
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Wazuh state
  const [agents, setAgents] = useState<WazuhAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [errorAgents, setErrorAgents] = useState('');
  const [showAgentForm, setShowAgentForm] = useState(false);

  const [showMetrics, setShowMetrics] = useState(false);
  const [metricsData, setMetricsData] = useState<any>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const statusMap: Record<number, { label: string; icon: JSX.Element | null }> =
    {
      0: {
        label: 'Up',
        icon: <CheckCircle size={20} className="text-green-400" />,
      },
      1: {
        label: 'Warning',
        icon: <AlertTriangle size={20} className="text-yellow-400" />,
      },
      2: {
        label: 'Down',
        icon: <XCircle size={20} className="text-red-500" />,
      },
    };

  // Ambil userId dari localStorage
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        setUserId(user.id);
      } else {
        window.location.href = '/login';
      }
    } catch {
      window.location.href = '/login';
    }
  }, []);

  // Fetch PRTG Devices
  const fetchDevices = async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/devices/user/${userId}`);
      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Response from PRTG is not JSON: ' + text.slice(0, 100));
      }

      if (!res.ok) throw new Error(data?.error || 'Failed to fetch devices');

      const normalized: Device[] = (data || []).map((d: any) => ({
        prtgId: String(d.objid ?? ''),
        id: String(d.id ?? ''),
        name: String(d.name ?? ''),
        host: String(d.host ?? ''),
        status: Number(d.status ?? 0),
      }));
      setDevices(normalized);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // ===================== FETCH WAZUH AGENTS =====================
  const fetchAgents = async () => {
    if (!userId) return;
    setLoadingAgents(true);
    setErrorAgents('');
    try {
      const res = await fetch(`${API_BASE}/api/wazuh/agents/user/${userId}`);
      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // fallback kalau Wazuh/Backend balik HTML atau bukan JSON
        data = { ok: res.ok, message: text.slice(0, 200) };
      }

      if (!res.ok)
        throw new Error(
          data?.error || data?.message || 'Failed to fetch Wazuh agents'
        );
      setAgents(data || []);
    } catch (e: any) {
      setErrorAgents(e.message || 'Unknown error');
    } finally {
      setLoadingAgents(false);
    }
  };

  // ===================== DELETE WAZUH AGENT =====================
  const handleDeleteAgent = async (id: string) => {
    if (!userId) return;
    if (!confirm('Apakah kamu yakin ingin menghapus agent ini?')) return;

    try {
      const res = await fetch(
        `${API_BASE}/api/wazuh/agents/byid/${id}/user/${userId}`,
        { method: 'DELETE' }
      );
      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: res.ok, message: text.slice(0, 200) };
      }

      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to delete agent');

      alert('✅ Agent berhasil dihapus');
      await fetchAgents();
    } catch (e: any) {
      alert('Error deleting agent: ' + (e.message || 'Unknown error'));
    }
  };

  // ===================== FETCH WAZUH AGENT METRICS =====================
  const fetchAgentMetrics = async (agentId: string) => {
    if (!userId) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/wazuh/agents/${agentId}/metrics/user/${userId}`
      );
      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: res.ok, message: text.slice(0, 200) };
      }

      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to fetch metrics');

      setMetricsData(data);
      setShowMetrics(true);
    } catch (e: any) {
      alert('Error fetching metrics: ' + (e.message || 'Unknown error'));
    }
  };

  useEffect(() => {
    if (userId) fetchDevices();
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'wazuh' && userId) {
      fetchAgents();
    }
  }, [activeTab, userId]);

  // CRUD handlers PRTG
  const handleEditDevice = (dbId: string, currentName: string) => {
    setEditingId(dbId);
    setEditName(currentName);
  };

  const handleUpdateDevice = async (dbId: string) => {
    if (!editName.trim()) {
      alert('Nama device tidak boleh kosong');
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/devices/byid/${encodeURIComponent(dbId)}/user/${userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update device');
      alert('✅ Nama device berhasil diperbarui');
      setEditingId(null);
      await fetchDevices();
    } catch (e: any) {
      alert('Error updating device: ' + (e.message || 'Unknown error'));
    }
  };

  const handleDeleteDevice = async (id: string) => {
    if (!confirm(`Apakah kamu yakin ingin menghapus device #${id}?`)) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/devices/byid/${encodeURIComponent(id)}/user/${userId}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to delete device');
      }
      setDevices((prev) => prev.filter((d) => d.id !== id));
      alert('✅ Device berhasil dihapus dari PRTG & Database');
    } catch (e: any) {
      alert('Error deleting device: ' + (e.message || 'Unknown error'));
    } finally {
      await fetchDevices();
    }
  };

  // CRUD handlers Wazuh
  const handleAddAgent = async (agent: any) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/api/wazuh/agents/user/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to add agent');
      alert('✅ Agent berhasil ditambahkan');
      setShowAgentForm(false);
      await fetchAgents();
    } catch (e: any) {
      alert('Error adding agent: ' + (e.message || 'Unknown error'));
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white font-sans p-6 relative">
      <div className="bg-[#1e293b] rounded-xl p-6 w-full">
        {/* Tabs */}
        <div className="flex gap-4 border-b border-gray-700 mb-4">
          <button
            className={`pb-2 px-4 ${
              activeTab === 'prtg'
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            onClick={() => setActiveTab('prtg')}
          >
            PRTG Devices
          </button>
          <button
            className={`pb-2 px-4 ${
              activeTab === 'wazuh'
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            onClick={() => setActiveTab('wazuh')}
          >
            Wazuh Agents
          </button>
        </div>

        {/* Content */}
        {activeTab === 'prtg' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">PRTG Device Management</h2>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-1.5 px-4 rounded-md flex items-center gap-2"
                onClick={() => setShowForm(true)}
              >
                <Plus size={16} /> Add Device
              </button>
            </div>
            {loading && <p>Loading devices...</p>}
            {error && <p className="text-red-500 mb-4">{error}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="py-2 px-4">PRTG ID</th>
                    <th className="py-2 px-4">Name</th>
                    <th className="py-2 px-4">Host</th>
                    <th className="py-2 px-4">Status</th>
                    <th className="py-2 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-gray-700 hover:bg-[#334155]"
                    >
                      <td className="py-3 px-4">{d.prtgId}</td>
                      <td className="py-3 px-4">
                        {editingId === d.id ? (
                          <input
                            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                        ) : (
                          d.name
                        )}
                      </td>
                      <td className="py-3 px-4">{d.host}</td>
                      <td className="py-3 px-4 flex items-center gap-2">
                        {statusMap[d.status]?.icon}
                        <span>{statusMap[d.status]?.label}</span>
                      </td>
                      <td className="py-3 px-4 flex gap-2">
                        {editingId === d.id ? (
                          <>
                            <button
                              className="px-3 py-1 bg-green-600 rounded hover:bg-green-700 text-white text-sm"
                              onClick={() => handleUpdateDevice(d.id)}
                            >
                              Save
                            </button>
                            <button
                              className="px-3 py-1 bg-gray-500 rounded hover:bg-gray-600 text-white text-sm"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="px-3 py-1 bg-yellow-600 rounded hover:bg-yellow-700 text-white text-sm flex items-center gap-1"
                              onClick={() => handleEditDevice(d.id, d.name)}
                            >
                              <Pencil size={14} /> Edit
                            </button>
                            <button
                              className="px-3 py-1 bg-red-600 rounded hover:bg-red-700 text-white text-sm flex items-center gap-1"
                              onClick={() => handleDeleteDevice(d.id)}
                            >
                              <Trash2 size={14} /> Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {devices.length === 0 && !loading && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-gray-400">
                        No devices found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'wazuh' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Wazuh Agent Management</h2>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-1.5 px-4 rounded-md flex items-center gap-2"
                onClick={() => setShowAgentForm(true)}
              >
                <Plus size={16} /> Add Agent
              </button>
            </div>
            {loadingAgents && <p>Loading agents...</p>}
            {errorAgents && <p className="text-red-500 mb-4">{errorAgents}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="py-2 px-4">Agent ID</th>
                    <th className="py-2 px-4">Name</th>
                    <th className="py-2 px-4">IP</th>
                    <th className="py-2 px-4">Status</th>
                    <th className="py-2 px-4">OS</th>
                    <th className="py-2 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-gray-700 hover:bg-[#334155]"
                    >
                      <td className="py-3 px-4">{a.agentId}</td>
                      <td className="py-3 px-4">{a.name}</td>
                      <td className="py-3 px-4">{a.ip}</td>
                      <td className="py-3 px-4">{a.status}</td>
                      <td className="py-3 px-4">{a.os}</td>
                      <td className="py-3 px-4 flex gap-2">
                        <button
                          className="px-3 py-1 bg-red-600 rounded hover:bg-red-700 text-white text-sm flex items-center gap-1"
                          onClick={() => handleDeleteAgent(a.id)}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                        <button
                          className="px-3 py-1 bg-indigo-600 rounded hover:bg-indigo-700 text-white text-sm flex items-center gap-1"
                          onClick={() => fetchAgentMetrics(a.id)}
                        >
                          <BarChart2 size={14} /> View Metrics
                        </button>
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && !loadingAgents && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-gray-400">
                        No agents found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal Add Device */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center">
          <AddDeviceForm onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Modal Add Agent */}
      {showAgentForm && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center">
          <AddAgentForm
            onCancel={() => setShowAgentForm(false)}
            onSave={handleAddAgent}
          />
        </div>
      )}

      {/* Modal Metrics */}
      {showMetrics && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center">
          <div className="bg-[#1e293b] rounded-xl p-6 w-[500px]">
            <h2 className="text-lg font-semibold mb-4">Agent Metrics</h2>
            <pre className="bg-gray-800 p-4 rounded text-sm overflow-x-auto">
              {JSON.stringify(metricsData, null, 2)}
            </pre>
            <div className="flex justify-end mt-4">
              <button
                className="px-4 py-2 bg-gray-500 rounded hover:bg-gray-600 text-white text-sm"
                onClick={() => setShowMetrics(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
