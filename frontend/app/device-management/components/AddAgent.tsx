'use client';

import { useState } from 'react';

export default function AddAgentForm({ onCancel, onSave }: { onCancel: () => void; onSave: (agent: any) => void }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [os, setOs] = useState('');
  const [group, setGroup] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ip.trim() || !os.trim()) {
      alert('⚠️ Name, IP, dan OS wajib diisi!');
      return;
    }
    onSave({ name, ip, os, group });
    setName('');
    setIp('');
    setOs('');
    setGroup('');
  };

  return (
    <div className="bg-[#1e293b] p-6 rounded-lg w-96">
      <h3 className="text-lg font-semibold mb-4">Add Agent</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Agent Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-600 text-white"
        />
        <input
          type="text"
          placeholder="IP Address"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-600 text-white"
        />
        <input
          type="text"
          placeholder="Operating System"
          value={os}
          onChange={(e) => setOs(e.target.value)}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-600 text-white"
        />
        <input
          type="text"
          placeholder="Group (optional)"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-600 text-white"
        />
        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="bg-gray-500 hover:bg-gray-600 px-4 py-1 rounded"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 px-4 py-1 rounded"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
