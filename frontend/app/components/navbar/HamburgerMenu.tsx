"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { signOut } from "next-auth/react";

/* 🧩 Definisikan tipe data User agar tidak any */
type User = {
  id?: string;
  username?: string;
  email?: string;
  role?: "superadmin" | "admin" | "user" | string;
};

/* 🧠 Custom hook untuk ambil user dari localStorage */
function useUser(): User | null {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("user");
      if (stored) {
        setUser(JSON.parse(stored) as User);
      }
    } catch (err) {
      console.error("Failed to parse user from localStorage:", err);
      setUser(null);
    }
  }, []);

  return user;
}

export default function HamburgerMenu() {
  const user = useUser();
  const role = user?.role ?? null;
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const baseMenu = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/device", label: "Devices" },
    { href: "/sensor", label: "Sensors" },
    { href: "/alert", label: "Alerts" },
    { href: "/sla", label: "SLA" },
    { href: "/account", label: "Account" },
  ];

  const ticket = { href: "/ticket", label: "Ticket" };
  const userManagement = { href: "/user-management", label: "User Managements" };
  const deviceManagement = { href: "/device-management", label: "Device Managements" };
  const sensorManagement = { href: "/sensor-management", label: "Sensor Managements" };

  let menuItems = [...baseMenu];

  if (role === "superadmin") {
    menuItems.push(ticket, userManagement, deviceManagement, sensorManagement);
  } else if (role === "admin") {
    menuItems.push(ticket, deviceManagement, sensorManagement);
  } else if (role === "user") {
    // Tidak menambah apapun
  } else {
    menuItems = [
      { href: "/login", label: "Login" },
      { href: "/dashboard", label: "Dashboard" },
    ];
  }

  return (
    <>
      {/* Tombol hamburger */}
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 rounded-md bg-transparent border border-white/10"
        aria-label="Open menu"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-[#071323] text-white z-50 transform ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } transition-transform duration-200 flex flex-col`}
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Image src="/Pressoc.png" alt="Logo" width={40} height={40} />
            <span className="text-2xl font-bold">PRESSOC</span>
          </div>
          <button onClick={() => setIsOpen(false)} aria-label="Close menu">
            ✕
          </button>
        </div>

        {/* Menu */}
        <ul className="flex-1 p-6 space-y-3 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`block py-2 px-3 rounded ${
                    isActive
                      ? "text-[#5d7bb6] border-b-2 border-[#5d7bb6]"
                      : "hover:text-[#5d7bb6]"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Footer sidebar */}
        <div className="p-6 border-t border-white/10 flex justify-between items-center">
          {user && (
            <div className="text-sm opacity-90">
              <div>{user.username ?? user.email ?? "Unknown User"}</div>
              <div className="capitalize">Role: {role ?? "-"}</div>
            </div>
          )}

          {/* Tombol logout */}
          <button
            onClick={async () => {
              try {
                const userId = user?.id;
                const username = user?.username ?? user?.email ?? "";

                await fetch("http://localhost:3001/logout", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId, username }),
                });

                localStorage.removeItem("user");
                await signOut({ callbackUrl: "/login" });
              } catch (error) {
                console.error("Logout error:", error);
                localStorage.removeItem("user");
                await signOut({ callbackUrl: "/login" });
              }

              setIsOpen(false);
            }}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
