"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";

interface AgentInfo {
  id: string;
  agentId: string;
  name: string;
  ip?: string;
  status: string;
  os?: string;
  manager?: string;
  group?: string;
  version?: string;
  createdAt: string;
  updatedAt: string;
}

interface MetricData {
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
}

interface LogData {
  id: string;
  timestamp: string;
  rule?: {
    level: string;
    description: string;
  };
  data?: {
    srcip?: string;
    dstip?: string;
  };
  message?: string;
}

interface VulnerabilityData {
  severity: string;
  count: number;
}

interface ComplianceData {
  percentage: number;
  lastCheck: string;
}

interface SummaryData {
  total: number;
  severityCounts: Record<string, number>;
  hourlyCounts: Record<string, number>;
  agentInfo: AgentInfo;
}

const AgentDashboard = () => {
  const params = useParams();
  const identifier = params?.identifier as string; // Asumsi dynamic route: /agent/[identifier]
  const [userId] = useState("user123"); // Ganti dengan auth context (e.g., useAuth().userId)
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [metrics, setMetrics] = useState<MetricData[]>([]);
  const [logs, setLogs] = useState<LogData[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [vulns, setVulns] = useState<VulnerabilityData[]>([]);
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = "http://localhost:3001"; // Sesuaikan dengan backend URL

  useEffect(() => {
    if (!identifier) return;

    const fetchAgentData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch agent info (dari endpoint DB, atau extend jika butuh)
        const agentRes = await fetch(`${API_BASE}/api/wazuh/agents/${identifier}/info/user/${userId}`);
        if (!agentRes.ok) throw new Error("Agent not found");
        const agentData = await agentRes.json();
        setAgentInfo(agentData);

        // Fetch metrics (historis dari DB, limit 50 untuk chart)
        const metricsRes = await fetch(`${API_BASE}/api/wazuh/agents/${identifier}/metrics/user/${userId}?limit=50`);
        const metricsData = await metricsRes.json();
        setMetrics(metricsData.metrics || []);

        // Fetch logs/alerts dengan summary
        const logsRes = await fetch(`${API_BASE}/api/wazuh/agents/${identifier}/logs/user/${userId}?limit=20&from=now-24h`);
        const logsData = await logsRes.json();
        setLogs(logsData.logs || []);
        setSummary(logsData.summary || null);

        // Fetch vulnerabilities
        const vulnsRes = await fetch(`${API_BASE}/api/wazuh/agents/${identifier}/vulnerabilities/user/${userId}`);
        const vulnsData = await vulnsRes.json();
        setVulns(vulnsData || []);

        // Fetch compliance
        const complianceRes = await fetch(`${API_BASE}/api/wazuh/agents/${identifier}/compliance/user/${userId}`);
        const complianceData = await complianceRes.json();
        setCompliance(complianceData || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch data");
      } finally {
        setLoading(false);
      }
    };

    fetchAgentData();

    // Refresh setiap 30 detik untuk real-time (opsional, untuk dashboard live)
    const interval = setInterval(fetchAgentData, 30000);
    return () => clearInterval(interval);
  }, [identifier, userId]);

  if (loading) {
    return (
      <div className="bg-[#0f172a] text-white min-h-screen flex items-center justify-center">
        <div className="text-center">Loading agent data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#0f172a] text-white min-h-screen flex items-center justify-center">
        <div className="text-center text-red-400">Error: {error}</div>
      </div>
    );
  }

  if (!agentInfo) {
    return (
      <div className="bg-[#0f172a] text-white min-h-screen flex items-center justify-center">
        <div className="text-center">Agent not found</div>
      </div>
    );
  }

  // Colors untuk charts (SOC style: green for good, red for critical)
  const COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"]; // Green, Yellow, Red, Purple
  const SEVERITY_COLORS = {
    low: "#22c55e",
    medium: "#f59e0b",
    high: "#ef4444",
    critical: "#dc2626",
  };

  // Format metrics untuk chart (jika metrics dari DB)
  const chartMetrics = metrics.map((m) => ({
    timestamp: new Date(m.timestamp).toLocaleTimeString(),
    cpu: m.cpuUsage,
    memory: m.memoryUsage,
    disk: m.diskUsage,
  }));

  // Format vulns untuk pie/bar
  const vulnPieData = vulns.map((v) => ({ name: v.severity, value: v.count }));

  // Format severity counts untuk pie
  const severityPieData = summary?.severityCounts
    ? Object.entries(summary.severityCounts).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="bg-[#0f172a] text-white min-h-screen p-6 space-y-6">
      {/* Header: Agent Overview */}
      <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{agentInfo.name}</h1>
            <p className="text-gray-300">ID: {agentInfo.agentId} | IP: {agentInfo.ip || "N/A"}</p>
            <p className="text-sm text-gray-400">
              OS: {agentInfo.os || "N/A"} | Version: {agentInfo.version || "N/A"} | Group: {agentInfo.group || "N/A"}
            </p>
          </div>
          <div className={`px-4 py-2 rounded-md font-semibold ${
            agentInfo.status === "active" ? "bg-green-600" : "bg-red-600"
          }`}>
            Status: {agentInfo.status.toUpperCase()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Metrics Cards */}
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">CPU Usage</h3>
          <div className="text-3xl font-bold text-green-400">{metrics[0]?.cpuUsage?.toFixed(1) || 0}%</div>
          <p className="text-sm text-gray-400">Current</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Memory Usage</h3>
          <div className="text-3xl font-bold text-yellow-400">{metrics[0]?.memoryUsage?.toFixed(1) || 0}%</div>
          <p className="text-sm text-gray-400">Current</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Disk Usage</h3>
          <div className="text-3xl font-bold text-red-400">{metrics[0]?.diskUsage?.toFixed(1) || 0}%</div>
          <p className="text-sm text-gray-400">Current</p>
        </div>
      </div>

      {/* Metrics Trends Chart */}
      <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
        <h3 className="text-lg font-semibold mb-4">System Metrics Trend (Last 50 Samples)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartMetrics}>
            <XAxis dataKey="timestamp" />
            <YAxis />
            <Tooltip />
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <Line type="monotone" dataKey="cpu" stroke="#ef4444" strokeWidth={2} name="CPU" />
            <Line type="monotone" dataKey="memory" stroke="#f59e0b" strokeWidth={2} name="Memory" />
            <Line type="monotone" dataKey="disk" stroke="#22c55e" strokeWidth={2} name="Disk" />
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alerts Severity Pie */}
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Alerts Severity (Last 24h)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={severityPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                fill="#8884d8"
                label
              >
                {severityPieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={SEVERITY_COLORS[entry.name as keyof typeof SEVERITY_COLORS] || COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <p className="text-sm text-gray-400 mt-2">Total Alerts: {summary?.total || 0}</p>
        </div>

        {/* Vulnerabilities Bar */}
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Vulnerabilities by Severity</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={vulnPieData}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <Bar dataKey="value" fill="#8884d8" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Compliance Circle (mirip SLA) */}
      <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
        <div className="flex flex-col items-center gap-6 text-center">
          <h2 className="text-xl font-bold">Compliance Score</h2>
          <div className="relative w-20 h-20">
            <svg viewBox="0 0 36 36" className="w-full h-full">
              <path
                className="text-gray-700"
                stroke="currentColor"
                strokeWidth="3"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-green-400"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray={`${compliance?.percentage || 0}, 100`}
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg font-semibold">
              {(compliance?.percentage || 0).toFixed(1)}%
            </div>
          </div>
          <div>
            <p className={`text-xl font-semibold ${
              (compliance?.percentage || 0) >= 90 ? "text-green-400" : "text-red-400"
            }`}>
              {(compliance?.percentage || 0) >= 90 ? "Compliant" : "Non-Compliant"}
            </p>
            <p className="text-sm text-gray-400">Last Check: {new Date(compliance?.lastCheck || Date.now()).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Recent Logs/Alerts Table */}
      <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Recent Alerts/Logs (Last 20)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-600">
                <th className="text-left py-2">Timestamp</th>
                <th className="text-left py-2">Severity</th>
                <th className="text-left py-2">Description</th>
                <th className="text-left py-2">Source IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 10).map((log, index) => (
                <tr key={index} className="border-b border-gray-700 hover:bg-gray-700">
                  <td className="py-2">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className={`py-2 font-semibold ${SEVERITY_COLORS[log.rule?.level as keyof typeof SEVERITY_COLORS]}`}>
                    {log.rule?.level || "Unknown"}
                  </td>
                  <td className="py-2">{log.rule?.description || log.message || "N/A"}</td>
                  <td className="py-2">{log.data?.srcip || "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs.length === 0 && <p className="text-gray-400 text-center py-4">No recent alerts</p>}
      </div>
    </div>
  );
};

export default AgentDashboard;
