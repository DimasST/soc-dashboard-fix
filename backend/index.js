import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import axios from "axios";
import bodyParser from "body-parser";
import "dotenv/config";
import qs from "qs"; // untuk format x-www-form-urlencoded
import midtransClient from "midtrans-client";
import https from "https";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = 3001;
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// ==================== EMAIL HELPER ====================
async function sendEmail({ to, subject, html }) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"SOC Dashboard" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });

    console.log(`📩 Email sent to ${to}`);
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err);
    throw err;
  }
}


// ====== KONFIGURASI PRTG ======
const PRTG_HOST = process.env.PRTG_HOST; // contoh: http://127.0.0.1
const PRTG_USERNAME = process.env.PRTG_USERNAME;
const PRTG_PASSHASH = process.env.PRTG_PASSHASH;

// Midtrans Core API
let coreApi = new midtransClient.CoreApi({
  isProduction: false, // sandbox
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});


app.post("/api/devices", async (req, res) => {
  const { name, host, parentId, templateId, userId } = req.body;

  if (!name || !host || !parentId) {
    return res.status(400).json({ error: "Name, host, dan parentId wajib diisi" });
  }
  if (!userId) {
    return res.status(400).json({ error: "User ID wajib disertakan" });
  }

  try {
    const TEMPLATE_ID = String(templateId || process.env.PRTG_DEVICE_TEMPLATE_ID || "").trim();
    if (!TEMPLATE_ID) {
      return res.status(400).json({ error: "PRTG_DEVICE_TEMPLATE_ID belum diset dan templateId tidak dikirim" });
    }

    // 1) Clone template device
    let newDeviceId = null;
    try {
      const dupResp = await axios.get(`${PRTG_HOST}/api/duplicateobject.htm`, {
        params: {
          id: TEMPLATE_ID,
          targetid: parentId,
          name: name.trim(),
          username: PRTG_USERNAME,
          passhash: PRTG_PASSHASH,
        },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      const loc = dupResp.headers?.location || dupResp.request?.res?.headers?.location;
      if (loc) {
        const m = /id=(\d+)/.exec(loc);
        if (m) newDeviceId = m[1];
      }
    } catch (e) {
      console.warn("⚠️ Clone device redirect gagal:", e.message);
    }

    // 2) Fallback cari device
    if (!newDeviceId) {
      const listResp = await axios.get(`${PRTG_HOST}/api/table.json`, {
        params: {
          content: "devices",
          columns: "objid,device,host,parentid",
          filter_parentid: parentId,
          filter_device: name.trim(),
          username: PRTG_USERNAME,
          passhash: PRTG_PASSHASH,
        },
      });
      const found = listResp.data?.devices?.find((d) => String(d.device) === name.trim());
      if (found) newDeviceId = String(found.objid);
    }

    if (!newDeviceId) {
      return res.status(500).json({ error: "Gagal menentukan objid device baru setelah clone" });
    }

    // 3) Tunggu valid
    await new Promise(r => setTimeout(r, 3000));

    // 4) Set host
    await axios.get(`${PRTG_HOST}/api/setobjectproperty.htm`, {
      params: {
        id: newDeviceId,
        name: "host",
        value: host.trim(),
        username: PRTG_USERNAME,
        passhash: PRTG_PASSHASH,
      },
    });

    // 5) Cek parent group status
    const parentResp = await axios.get(`${PRTG_HOST}/api/table.json`, {
      params: {
        content: "groups",
        columns: "objid,group,status,message_raw",
        filter_objid: parentId,
        username: PRTG_USERNAME,
        passhash: PRTG_PASSHASH,
      },
    });

    const parentInfo = parentResp.data?.groups?.[0];
    if (parentInfo && /paused/i.test(parentInfo.message_raw || "")) {
      console.log(`⚠️ Parent group ${parentId} masih paused → auto resume`);
      await axios.get(`${PRTG_HOST}/api/pause.htm`, {
        params: {
          id: parentId,
          action: 0,
          recurse: 1,
          username: PRTG_USERNAME,
          passhash: PRTG_PASSHASH,
        },
      });
    }

    // 6) Resume device baru
    await axios.get(`${PRTG_HOST}/api/pause.htm`, {
      params: {
        id: newDeviceId,
        action: 0,
        recurse: 1,
        username: PRTG_USERNAME,
        passhash: PRTG_PASSHASH,
      },
    });

    // 7) Save ke DB
    let deviceDb = null;
    try {
      deviceDb = await prisma.device.create({
        data: {
          name: name.trim(),
          host: host.trim(),
          prtgId: newDeviceId,
          userId: userId,
          parentId: parentId,
          status: 0,
        },
      });
    } catch (dbErr) {
      console.error("❌ Error saving device to DB:", dbErr.message);
    }

    return res.json({
      success: true,
      message: "Device created + auto resume (parent & child)",
      objectId: newDeviceId,
      device: deviceDb,
    });
  } catch (error) {
    console.error("❌ Error creating device:", error?.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to create device: " + (error?.response?.data || error.message),
    });
  }
});


// Get devices
app.get("/api/devices", async (req, res) => {
  try {
    const url = `${PRTG_HOST}/api/table.json`;
    const params = {
      content: "devices",
      columns: "objid,device,host,group,probe,status",
      username: PRTG_USERNAME,
      passhash: PRTG_PASSHASH,
    };
    const response = await axios.get(url, { params });
    res.json(response.data.devices || []);
  } catch (error) {
    console.error("Error fetching devices:", error.message);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// Get devices milik user tertentu
app.get("/api/devices/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const devices = await prisma.device.findMany({
      where: { userId },
      include: { sensors: true },
    });

    const mappedDevices = devices.map(d => ({
      id: d.id,               // UUID device
      objid: d.prtgId,        // PRTG ID
      name: d.name,
      host: d.host || "-",
      parentid: d.parentId || "",
      status: d.status ?? 0,
    }));

    res.json(mappedDevices);
  } catch (error) {
    console.error("Error fetching user devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});


app.patch("/api/devices/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) return res.status(400).json({ error: "New name is required" });

  try {
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || !device.prtgId) {
      return res.status(404).json({ error: "Device not found or prtgId missing" });
    }

    const url = `${process.env.PRTG_HOST}/api/setobjectproperty.htm`;
    const params = {
      id: device.prtgId,
      name: "name",
      value: name.trim(),
      username: process.env.PRTG_USERNAME,
      passhash: process.env.PRTG_PASSHASH,
    };

    const response = await axios.get(url, { params });
    const resultText = typeof response.data === "string" ? response.data : "OK";

    const updated = await prisma.device.update({
      where: { id },
      data: { name: name.trim() },
    });

    res.json({ success: true, device: updated, raw: resultText });
  } catch (error) {
    console.error("❌ Error updating device:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to update device" });
  }
});



app.delete("/api/devices/:prtgId", async (req, res) => {
  const { prtgId } = req.params;

  try {
    // cari device di DB
    const device = await prisma.device.findFirst({ where: { prtgId } });
    if (!device) {
      return res.status(404).json({ error: "Device tidak ditemukan di DB" });
    }

    // coba hapus di PRTG
    const delUrl = `${PRTG_HOST}/api/deleteobject.htm`;
    const delParams = {
      id: device.prtgId,
      approve: 1,
      username: PRTG_USERNAME,
      passhash: PRTG_PASSHASH,
    };

    try {
      await axios.get(delUrl, { params: delParams });
    } catch (err) {
      const xmlError = err?.response?.data;
      if (xmlError?.includes("There is no object with the specified ID")) {
        console.warn(`⚠️ Device #${device.prtgId} tidak ada di PRTG, lanjut hapus DB saja.`);
      } else {
        throw err; // kalau error lain, lempar
      }
    }

    // hapus di DB (cascade akan beresin sensor + logs)
    await prisma.device.delete({ where: { id: device.id } });

    return res.json({ success: true, message: "✅ Device deleted from DB (and PRTG if existed)" });
  } catch (error) {
    console.error("❌ Error deleting device:", error.message);
    return res.status(500).json({ error: "Failed to delete device: " + error.message });
  }
});




// Get groups
app.get("/api/groups", async (req, res) => {
  try {
    const url = `${PRTG_HOST}/api/table.json`;
    const params = {
      content: "groups",
      columns: "objid,group,probe",
      username: PRTG_USERNAME,
      passhash: PRTG_PASSHASH,
    };
    const response = await axios.get(url, { params });
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching groups:", error.message);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
});

/* ==================== LOGIN ==================== */
app.post("/login", async (req, res) => {
  const { username, password, userAgent } = req.body;
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        subscriptionProfile: true, // ambil data langganan user
      },
    });
    if (!user) return res.status(401).json({ error: "User  not found" });
    if (!user.password) {
      return res.status(401).json({ error: "User  has no password set" });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: "Invalid credentials" });

    await prisma.userLog.create({
      data: {
        userId: user.id,
        username: user.username || "",
        action: "login",
        ip: req.ip || "",
        userAgent: userAgent || req.headers["user-agent"] || "",
      },
    });

    res.json({
      id: user.id,
      name: user.username,
      email: user.email ?? "",
      role: user.role,
      plan: user.subscriptionProfile?.plan || "free", // kirim plan user
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


/* ==================== LOGOUT ==================== */
app.post("/logout", async (req, res) => {
  try {
    const { userId, username, userAgent } = req.body;
    if (!userId || !username) {
      return res.status(400).json({ error: "User ID and username are required" });
    }
    await prisma.userLog.create({
      data: {
        userId,
        username,
        action: "logout",
        ip: req.ip || "",
        userAgent: userAgent || req.headers["user-agent"] || "",
      },
    });
    res.json({ success: true, message: "User logged out" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ==================== USERS ==================== */
app.get("/api/user", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        isActivated: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(users);
  } catch (error) {
    console.error("Error getting users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/user/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.user.delete({ where: { id } });
    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

/* ==================== INVITATION & ACTIVATION ==================== */
app.post("/api/invitation", async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: "Email and role are required" });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: "Email already invited" });

    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    await prisma.user.create({ data: { email, role, isActivated: false, activationToken: token } });

    const activationLink = `http://localhost:3000/activate`;
    await sendEmail({ to: email, subject: "You're Invited to SOC Dashboard", html: `<p>Hello,</p><p>You have been invited as <strong>${role}</strong>.</p><p>Activation page: <a href="${activationLink}">${activationLink}</a></p><p>Token: <b>${token}</b></p>` });

    res.status(200).json({ success: true, message: "Invitation sent successfully", token });
  } catch (error) {
    console.error("Invitation error:", error);
    res.status(500).json({ error: "Failed to send invitation" });
  }
});

app.post("/api/activate", async (req, res) => {
  const { token, username, password, name } = req.body;
  if (!token || !username || !password || !name) return res.status(400).json({ error: "All fields are required" });

  try {
    const user = await prisma.user.findFirst({ where: { activationToken: token, isActivated: false } });
    if (!user) return res.status(400).json({ error: "Invalid or expired token" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const updated = await prisma.user.update({ where: { id: user.id }, data: { username, name, password: hashedPassword, isActivated: true, activationToken: null } });

    // ✅ Free trial (5 menit)
    if (user.isTrial) {
      setTimeout(async () => {
        try {
          await prisma.user.update({ where: { id: user.id }, data: { isActivated: false } });
          console.log(`⏳ Trial expired for ${user.email}`);
        } catch (err) { console.error(err); }
      }, 5 * 60 * 1000);
    }

    // ✅ Subscription (30 menit atau sesuai subscriptionDurationMinutes)
    if (!user.isTrial && user.subscriptionDurationMinutes) {
      setTimeout(async () => {
        try {
          await prisma.user.update({ where: { id: user.id }, data: { isActivated: false } });
          console.log(`⏳ Subscription expired for ${user.email}`);
        } catch (err) { console.error(err); }
      }, user.subscriptionDurationMinutes * 60 * 1000);
    }

    res.json({ success: true, user: { id: updated.id } });
  } catch (error) {
    console.error("Activation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ==================== SENSOR DATA ==================== */
app.get("/api/sensors", async (req, res) => {
  try {
    const sensors = await prisma.Sensor.findMany();
    res.json(sensors);
  } catch (error) {
    console.error("Error fetching sensors:", error);
    res.status(500).json({ error: "Failed to fetch sensors" });
  }
});

// Get sensors milik user tertentu (opsional, jika ingin endpoint terpisah)
app.get("/api/sensors/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    // Ambil semua sensor yang device-nya milik user tersebut
    const sensors = await prisma.Sensor.findMany({
      where: {
        device: {
          userId,
        },
      },
    });
    res.json(sensors);
  } catch (error) {
    console.error("Error fetching user sensors:", error);
    res.status(500).json({ error: "Failed to fetch sensors" });
  }
});

app.post("/api/sensors", async (req, res) => {
  const { name, type, deviceId, userId } = req.body;

  if (!name || !type || !deviceId || !userId) {
    return res.status(400).json({ error: "name, type, deviceId, userId wajib diisi" });
  }

  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || !device.prtgId) {
      return res.status(400).json({ error: "Device tidak ditemukan atau prtgId tidak tersedia" });
    }

    // 1. Tambahkan sensor di PRTG
    await axios.get(`${process.env.PRTG_HOST}/addsensor5.htm`, {
      params: {
        id: device.prtgId,
        name_: name,
        sensortype: type,
        username: process.env.PRTG_USERNAME,
        passhash: process.env.PRTG_PASSHASH,
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // 2. Ambil sensor terbaru dari device
    const listResp = await axios.get(`${process.env.PRTG_HOST}/api/table.json`, {
      params: {
        content: "sensors",
        columns: "objid,sensor,device",
        filter_device: device.name,
        username: process.env.PRTG_USERNAME,
        passhash: process.env.PRTG_PASSHASH,
      },
    });

    const sensors = listResp.data?.sensors || [];
    const found = sensors.find((s) => s.sensor === name);

    if (!found) {
      return res.status(500).json({ error: "Gagal menemukan sensor baru di PRTG" });
    }

    const prtgSensorId = String(found.objid);

    // 3. Simpan sensor ke database
    const sensor = await prisma.sensor.create({
      data: {
        name,
        type,
        deviceId,
        userId,
        prtgId: prtgSensorId, // ✅ pasti sensor ID, bukan device ID
        status: "Up",
      },
    });

    res.json({ success: true, sensor });
  } catch (error) {
    console.error("Error creating sensor:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create sensor" });
  }
});



app.put("/api/sensors/:id", async (req, res) => {
  const { id } = req.params;
  const { name, status } = req.body;

  try {
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    if (!sensor) return res.status(404).json({ error: "Sensor not found" });

    // Update ke PRTG
    if (name) {
      await axios.get(`${process.env.PRTG_HOST}/api/setobjectproperty.htm`, {
        params: {
          id: sensor.prtgId,
          name: "name",
          value: name,
          username: process.env.PRTG_USERNAME,
          passhash: process.env.PRTG_PASSHASH,
        },
      });
    }

    // Update DB
    const updated = await prisma.sensor.update({
      where: { id },
      data: { name: name || sensor.name, status: status || sensor.status },
    });

    res.json({ success: true, sensor: updated });
  } catch (error) {
    console.error("Error updating sensor:", error);
    res.status(500).json({ error: "Failed to update sensor" });
  }
});

app.delete("/api/sensors/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Cari sensor di DB
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    if (!sensor) return res.status(404).json({ error: "Sensor not found" });

    // 2. Hapus sensor di PRTG (pastikan approve=1 biar langsung hapus)
    await axios.get(`${process.env.PRTG_HOST}/deleteobject.htm`, {
      params: {
        id: sensor.prtgId, // ✅ ini sensor.objid yang valid, bukan deviceId
        approve: 1,
        username: process.env.PRTG_USERNAME,
        passhash: process.env.PRTG_PASSHASH,
      },
    });

    // 3. Hapus dari DB
    await prisma.sensor.delete({ where: { id } });

    res.json({ success: true, message: `Sensor ${sensor.name} (${sensor.id}) deleted` });
  } catch (error) {
    console.error("❌ Error deleting sensor:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to delete sensor" });
  }
});


app.get("/api/sensor-templates", async (req, res) => {
  try {
    const prtgResponse = await axios.get(
      `${process.env.PRTG_HOST}/api/sensortypes.json`,
      {
        params: {
          username: process.env.PRTG_USERNAME,
          passhash: process.env.PRTG_PASSHASH,
        },
      }
    );

    res.json(prtgResponse.data.sensortypes);
  } catch (error) {
    console.error("Error fetching sensor templates:", error);
    res.status(500).json({ error: "Failed to fetch sensor templates" });
  }
});


app.get("/api/devices/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const devices = await prisma.device.findMany({
      where: { userId },
      select: { id: true, name: true, prtgId: true },
    });
    res.json(devices);
  } catch (error) {
    console.error("Error fetching user devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

/* ==================== SYNC ALL SENSORS ==================== */
app.post("/api/sensors/sync", async (req, res) => {
  try {
    const prtgRes = await fetch(
      "http://PRTG_SERVER/api/table.json?content=sensors&output=json&username=YOUR_USER&password=YOUR_PASS"
    );
    const prtgData = await prtgRes.json();

    if (!prtgData?.sensors) {
      return res.status(400).json({ error: "Tidak ada data sensor dari PRTG" });
    }

    for (const s of prtgData.sensors) {
      const existing = await prisma.sensor.findUnique({
        where: { prtgId: String(s.objid) },
      });

      if (existing) {
        await prisma.sensor.update({
          where: { id: existing.id },
          data: {
            status: s.status_raw?.toString() ?? "unknown",
            lastValue: s.lastvalue ?? "-",
            message: s.message ?? null,
          },
        });

        await prisma.sensorLog.create({
          data: {
            value: String(s.lastvalue ?? "-"),
            sensorId: existing.id,
          },
        });
      }
    }

    res.json({ message: "Sync sensors selesai" });
  } catch (error) {
    console.error("Error sync sensor:", error);
    res.status(500).json({ error: "Gagal sync sensor dari PRTG" });
  }
});

/* ==================== SENSOR STATUS PER USER ==================== */
app.get("/api/sensors/status/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const sensors = await prisma.sensor.findMany({
      where: { userId },
      include: {
        device: true,
        logs: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const result = sensors.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      lastValue: s.lastValue,
      message: s.message,
      deviceName: s.device.name,
      deviceId: s.device.id,
      lastLog: s.logs[0]
        ? { value: s.logs[0].value, createdAt: s.logs[0].createdAt }
        : null,
    }));

    res.json(result);
  } catch (error) {
    console.error("Error fetching sensor status per user:", error);
    res.status(500).json({ error: "Gagal ambil status sensor user" });
  }
});

/* ==================== SENSOR LOG HISTORY ==================== */
app.get("/api/sensors/:sensorId/logs", async (req, res) => {
  const { sensorId } = req.params;

  try {
    const logs = await prisma.sensorLog.findMany({
      where: { sensorId },
      orderBy: { createdAt: "desc" },
      take: 50, // limit biar gak berat (bisa diubah sesuai kebutuhan)
    });
    res.json(logs);
  } catch (error) {
    console.error("Error fetching sensor logs:", error);
    res.status(500).json({ error: "Gagal ambil histori sensor" });
  }
});

/* ==================== DEVICES + SENSORS PER USER ==================== */
app.get("/api/devices/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const devices = await prisma.device.findMany({
      where: { userId },
      include: {
        sensors: {
          include: {
            logs: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    res.json(devices);
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ error: "Gagal ambil devices" });
  }
});


/* ==================== USER LOGS ==================== */
app.get("/api/user-logs", async (req, res) => {
  try {
    const logs = await prisma.userLog.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: true }, // optional, biar tau username
    });
    res.json(logs);
  } catch (error) {
    console.error("Error fetching user logs:", error);
    res.status(500).json({ error: "Failed to fetch user logs" });
  }
});

/* =========== NEW: PAYMENT FLOW (profile → invite + invoice) =========== */

/**
 * 1) Simpan data diri pendaftar (tanpa email). Frontend akan lanjut ke step bayar dummy → input email.
 * Body: { plan, price, companyName, fullName, city, country }
 * Return: { profileId }
 */
app.post("/api/payment/profile", async (req, res) => {
  try {
    const { plan, price, companyName, fullName, city, country, email } = req.body;
    if (!plan || price == null || !companyName || !fullName || !city || !country || !email) {
      return res.status(400).json({ error: "Semua field profil wajib diisi" });
    }

    const profile = await prisma.subscriptionProfile.create({
      data: {
        plan: String(plan),
        price: parseInt(price, 10),
        companyName,
        fullName,
        city,
        country,
        email, // ✅ simpan email juga
      },
      select: { id: true },
    });

    res.json({ success: true, profileId: profile.id });
  } catch (error) {
    console.error("Payment profile error:", error);
    res.status(500).json({ error: "Failed to create payment profile" });
  }
});

/**
 * 2) Setelah bayar dummy, user masukkan email untuk undangan admin.
 * Body: { profileId, email, role }  (role biasanya "admin")
 * - Buat user (cek email unik)
 * - Set user.subscriptionDurationMinutes = 30 (sesuai requirement)
 * - Update SubscriptionProfile.userId
 * - Kirim email undangan + email invoice dummy (menggunakan data profile)
 * Return: { token }
 */
app.post("/api/payment/invite", async (req, res) => {
  try {
    const { profileId, email, role } = req.body;
    if (!profileId || !email || !role) {
      return res.status(400).json({ error: "profileId, email, dan role wajib diisi" });
    }

    const profile = await prisma.subscriptionProfile.findUnique({ where: { id: profileId } });
    if (!profile) return res.status(404).json({ error: "Payment profile tidak ditemukan" });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: "Email already registered" });

    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const user = await prisma.user.create({
      data: {
        email,
        role,
        isActivated: false,
        activationToken: token,
        isTrial: false,
        subscriptionDurationMinutes: 30, // ⬅️ 30 menit aktif setelah aktivasi
      },
    });

    // Link aktivasi
    const activationLink = `http://localhost:3000/activate`;

    // Email undangan (aktivasi)
    await sendEmail({
      to: email,
      subject: "Payment Success - Activate Your SOC Dashboard Account",
      html: `
        <h2>Thank you for your payment!</h2>
        <p>Your account is almost ready. Please activate it using the token below:</p>
        <p><a href="${activationLink}">${activationLink}</a></p>
        <p><b>Activation Token:</b> ${token}</p>
        <p><i>Note:</i> Setelah aktivasi, akun akan aktif <b>30 menit</b> kemudian otomatis menjadi <b>Inactive</b>.</p>
      `,
    });

    // Email invoice dummy (mengambil data dari profile)
    const invoiceNo = `INV-${Date.now()}`;
    const issuedAt = new Date().toLocaleString();

    await sendEmail({
      to: email,
      subject: `Invoice ${invoiceNo} - SOC Dashboard`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #eee; padding: 16px;">
          <h2 style="margin:0 0 8px 0;">Invoice (Dummy)</h2>
          <p style="margin:0 0 16px 0; color:#555;">${issuedAt}</p>
          <hr/>
          <h3 style="margin:16px 0 8px 0;">Billing To</h3>
          <table style="width:100%; border-collapse: collapse;">
            <tr><td style="padding:4px 0;"><b>Company</b></td><td>${profile.companyName}</td></tr>
            <tr><td style="padding:4px 0;"><b>Full Name</b></td><td>${profile.fullName}</td></tr>
            <tr><td style="padding:4px 0;"><b>City</b></td><td>${profile.city}</td></tr>
            <tr><td style="padding:4px 0;"><b>Country</b></td><td>${profile.country}</td></tr>
          </table>
          <h3 style="margin:16px 0 8px 0;">Order</h3>
          <table style="width:100%; border-collapse: collapse;">
            <tr><td style="padding:4px 0;"><b>Plan</b></td><td>${profile.plan}</td></tr>
            <tr><td style="padding:4px 0;"><b>Price</b></td><td>$${profile.price}</td></tr>
            <tr><td style="padding:4px 0;"><b>Invoice No.</b></td><td>${invoiceNo}</td></tr>
            <tr><td style="padding:4px 0;"><b>Status</b></td><td>Paid (Dummy)</td></tr>
          </table>
          <hr/>
          <p style="color:#777;">Ini adalah invoice simulasi untuk keperluan demo.</p>
        </div>
      `,
    });

    // Link-kan profile ke user yang diundang
    await prisma.subscriptionProfile.update({
      where: { id: profileId },
      data: { userId: user.id },
    });

    res.json({ success: true, message: "Invitation + invoice sent", token });
  } catch (error) {
    console.error("Payment invite error:", error);
    res.status(500).json({ error: "Failed to process invitation" });
  }
});


/* ==================== SUBSCRIPTION PROFILE ==================== */

// Get all subscription profiles
app.get("/api/subscription-profiles", async (req, res) => {
  try {
    const profiles = await prisma.subscriptionProfile.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            isActivated: true,
          },
        },
      },
    });
    res.json(profiles);
  } catch (error) {
    console.error("Error fetching subscription profiles:", error);
    res.status(500).json({ error: "Failed to fetch subscription profiles" });
  }
});

// Get single subscription profile by ID
app.get("/api/subscription-profiles/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const profile = await prisma.subscriptionProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            isActivated: true,
          },
        },
      },
    });

    if (!profile) {
      return res.status(404).json({ error: "Subscription profile not found" });
    }

    res.json(profile);
  } catch (error) {
    console.error("Error fetching subscription profile:", error);
    res.status(500).json({ error: "Failed to fetch subscription profile" });
  }
});

/* ==================== FREE TRIAL ==================== */
app.post("/api/free-trial", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "Email already exists" });
    }
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await prisma.user.create({
      data: {
        email,
        role: "admin",
        isActivated: false,
        activationToken: token,
        isTrial: true,
      },
    });

    const activationLink = `http://localhost:3000/activate?token=${token}`;
    await sendEmail({
      to: email,
      subject: "🎯 Free Trial Invitation - 5 Minutes",
      html: `
        <h2>Selamat! Anda mendapatkan trial 5 menit.</h2>
        <p>Klik link berikut untuk mengaktifkan akun Anda:</p>
        <p><a href="${activationLink}">${activationLink}</a></p>
        <p><b>Catatan:</b> Trial akan dimulai saat Anda aktivasi akun dan berakhir otomatis 5 menit kemudian.</p>
        <p>Token Aktivasi: <b>${token}</b></p>
      `,
    });

    res.json({ success: true, message: "Trial invitation sent" });
  } catch (error) {
    console.error("Free trial error:", error);
    res.status(500).json({ error: "Failed to create trial invitation" });
  }
});
/* ==================== Api Midtrans ==================== */
app.post("/api/payment/create-order", async (req, res) => {
  try {
    const { subscriptionProfileId, packageName, price } = req.body;
    const orderId = "ORDER-" + Date.now();

    if (!subscriptionProfileId || !packageName || !price) {
      return res.status(400).json({ error: "subscriptionProfileId, packageName, dan price wajib diisi" });
    }

    let parameter = {
      payment_type: "qris",
      transaction_details: { order_id: orderId, gross_amount: price },
    };

    const response = await coreApi.charge(parameter);

    await prisma.payment.create({
      data: {
        profileId: subscriptionProfileId, // ⬅️ pastikan sesuai nama field di schema
        orderId,
        package: packageName,
        price,
        status: "pending",
      },
    });

    res.json({ orderId, qrisUrl: response.actions[0].url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal create order" });
  }
});


// index.js
// index.js
// ✅ Callback Midtrans
app.post("/api/payment/callback", async (req, res) => {
  try {
    const { order_id, transaction_status } = req.body;

    const payment = await prisma.payment.findUnique({
      where: { orderId: order_id },
      include: { profile: { include: { user: true } } },
    });

    if (!payment) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (transaction_status === "settlement") {
      // ✅ update status payment
      await prisma.payment.update({
        where: { orderId: order_id },
        data: { status: "paid" },
      });

      const profile = payment.profile;
      let user = profile.user;

      // 🔑 Generate token baru untuk aktivasi internal
      const token =
        Math.random().toString(36).slice(2) + Date.now().toString(36);

      if (!user) {
        // cek apakah email sudah ada di tabel user
        user = await prisma.user.findUnique({
          where: { email: profile.email },
        });

        if (user) {
          // update token saja
          await prisma.user.update({
            where: { id: user.id },
            data: { activationToken: token, isActivated: false },
          });
        } else {
          // create user baru
          user = await prisma.user.create({
            data: {
              email: profile.email,
              name: profile.fullName,
              role: "admin",
              isActivated: false,
              activationToken: token,
              subscriptionDurationMinutes: 30,
            },
          });
        }

        // link profile ke user
        await prisma.subscriptionProfile.update({
          where: { id: profile.id },
          data: { userId: user.id },
        });
      } else {
        // update token untuk user yg udah ada
        await prisma.user.update({
          where: { id: user.id },
          data: { activationToken: token, isActivated: false },
        });
      }

      // ✅ kirim email invoice (tanpa token)
      await sendEmail({
        to: profile.email,
        subject: "Invoice Pembayaran SOC Dashboard",
        html: `
          <div style="font-family: Arial, sans-serif; line-height:1.6; color:#333">
            <h2 style="color:#0d6efd">Pembayaran Berhasil 🎉</h2>
            <p>Terima kasih sudah melakukan pembayaran. Berikut detail invoice Anda:</p>

            <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
              <tr>
                <td style="padding: 8px; border: 1px solid #ccc;"><b>Invoice ID</b></td>
                <td style="padding: 8px; border: 1px solid #ccc;">${order_id}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ccc;"><b>Company</b></td>
                <td style="padding: 8px; border: 1px solid #ccc;">${profile.companyName}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ccc;"><b>Full Name</b></td>
                <td style="padding: 8px; border: 1px solid #ccc;">${profile.fullName}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ccc;"><b>Email</b></td>
                <td style="padding: 8px; border: 1px solid #ccc;">${profile.email}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ccc;"><b>Plan</b></td>
                <td style="padding: 8px; border: 1px solid #ccc;">${profile.plan}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ccc;"><b>Harga</b></td>
                <td style="padding: 8px; border: 1px solid #ccc;">Rp${profile.price}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ccc;"><b>Status</b></td>
                <td style="padding: 8px; border: 1px solid #ccc; color:green;"><b>LUNAS</b></td>
              </tr>
            </table>

            <p>Silakan login ke aplikasi SOC Dashboard untuk melanjutkan penggunaan layanan Anda.</p>
            <p style="margin-top:30px; font-size:12px; color:#666;">
              Email ini dikirim secara otomatis, mohon tidak membalas ke alamat email ini.
            </p>
          </div>
        `,
      });

      console.log(`✅ User updated + invoice sent to ${profile.email}`);

      return res.json({
        success: true,
        message: "Payment settled, invoice email sent",
        activationToken: token, // ini tetap dikirim ke FE via API
        userId: user.id,
      });
    }

    // kalau masih pending / expire
    res.json({ success: false, transaction_status });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ error: "Callback processing failed" });
  }
});



// api/payment/status/:orderId
app.get("/api/payment/status/:orderId", async (req, res) => {
  const { orderId } = req.params;
  try {
    const payment = await prisma.payment.findUnique({
      where: { orderId },
      include: { profile: { include: { user: true } } },
    });

    if (!payment) return res.status(404).json({ success: false, error: "Order not found" });

    res.json({
      success: true,
      status: payment.status, // "pending" | "paid"
      activationToken: payment.profile?.user?.activationToken || null,
    });
  } catch (err) {
    console.error("Status check error:", err);
    res.status(500).json({ success: false, error: "Failed to check status" });
  }
});

/* ==================== WAZUH API ==================== */
const agent = new https.Agent({ rejectUnauthorized: false });
const insecureAgent = new https.Agent({ rejectUnauthorized: false });
/* ==================== GET ALL AGENTS BY USER ==================== */
app.get("/api/wazuh/agents/user/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const dbAgents = await prisma.wazuhAgent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const enriched = await Promise.all(
      dbAgents.map(async (a) => {
        try {
          // Pakai token manual dari env
          const wazuhRes = await fetch(
            `${process.env.WAZUH_API_URL}/agents?name=${encodeURIComponent(a.name)}`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
              },
              agent: insecureAgent, // self-signed certificate
            }
          );

          if (!wazuhRes.ok) {
            throw new Error(`Wazuh API returned ${wazuhRes.status}`);
          }

          const data = await wazuhRes.json();
          const w = data?.data?.affected_items?.[0];

          return {
            id: a.id,
            agentId: w?.id || a.agentId,
            name: a.name,
            ip: w?.ip || a.ip,
            status: w?.status || "unknown",
            os: w?.os?.name || a.os,
            group: w?.group || a.group,
            version: w?.version || a.version,
            createdAt: a.createdAt,
          };
        } catch (err) {
          console.warn(`⚠️ Failed to fetch agent ${a.name}:`, err.message);
          return {
            id: a.id,
            agentId: a.agentId,
            name: a.name,
            ip: a.ip,
            status: "unknown",
            os: a.os,
            group: a.group,
            version: a.version,
            createdAt: a.createdAt,
          };
        }
      })
    );

    res.json(enriched);
  } catch (error) {
    console.error("Error fetching user agents:", error.message);
    res.status(500).json({ error: "Failed to fetch user agents" });
  }
});



// POST tambah agent
/* ==================== CREATE NEW AGENT ==================== */
app.post("/api/wazuh/agents/user/:userId", async (req, res) => {
  const { userId } = req.params;
  const { name, ip, group, os } = req.body;

  try {
    // Step 1: Register agent ke Wazuh
    const wazuhRes = await fetch(`${process.env.WAZUH_API_URL}/agents/insert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
      },
      agent,
      body: JSON.stringify({ name, ip }),
    });

    if (!wazuhRes.ok) {
      const errText = await wazuhRes.text();
      throw new Error(
        `Wazuh API error: ${wazuhRes.status} ${wazuhRes.statusText} - ${errText}`
      );
    }

    const data = await wazuhRes.json();
    let agentId = data?.data?.affected_items?.[0]?.id;

    // Step 2: Kalau ID tidak dikembalikan, coba fetch dari Wazuh pakai nama
    if (!agentId) {
      const lookupRes = await fetch(
        `${process.env.WAZUH_API_URL}/agents?name=${encodeURIComponent(name)}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
          },
          agent,
        }
      );
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        agentId = lookupData?.data?.affected_items?.[0]?.id;
      }
    }

    if (!agentId) {
      throw new Error("Failed to resolve agentId from Wazuh");
    }

    // Step 3: Kalau user kasih group, update group di Wazuh
    if (group) {
      try {
        await fetch(
          `${process.env.WAZUH_API_URL}/agents/${agentId}/group/${group}`,
          {
            method: "PUT",
            headers: {
              "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
            },
            agent,
          }
        );
      } catch (err) {
        console.warn("⚠️ Failed to update group in Wazuh:", err.message);
      }
    }

    // Step 4: Simpan agent ke database pakai agentId asli
    const dbAgent = await prisma.wazuhAgent.create({
      data: {
        agentId, // ✅ pakai ID asli Wazuh
        name,
        ip,
        os,
        group: group || null,
        status: "registered",
        userId,
      },
    });

    res.status(201).json(dbAgent);
  } catch (error) {
    console.error("Error creating agent:", error.message);
    res.status(500).json({ error: "Failed to create agent" });
  }
});



/* ==================== UPDATE AGENT ==================== */
app.put("/api/wazuh/agents/:id/user/:userId", async (req, res) => {
  const { id, userId } = req.params;
  const { name, ip, status, group, os } = req.body;

  try {
    const existing = await prisma.wazuhAgent.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: "Agent not found" });
    }

    // Ambil agent terbaru dari Wazuh pakai nama
    const wazuhRes = await fetch(
      `${process.env.WAZUH_API_URL}/agents?name=${encodeURIComponent(existing.name)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
        },
        agent: insecureAgent,
      }
    );

    const data = await wazuhRes.json();
    const w = data?.data?.affected_items?.[0];
    const agentId = w?.id || existing.agentId;

    // Update group di Wazuh kalau ada
    if (group && agentId) {
      await fetch(`${process.env.WAZUH_API_URL}/agents/${agentId}/group/${group}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${process.env.WAZUH_API_TOKEN}` },
        agent: insecureAgent,
      }).catch((err) => console.warn("Failed update group in Wazuh:", err.message));
    }

    const updated = await prisma.wazuhAgent.update({
      where: { id },
      data: { name, ip, status, group, os, agentId },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating agent:", error.message);
    res.status(500).json({ error: "Failed to update agent" });
  }
});

/* ==================== DELETE AGENT ==================== */
app.delete("/api/wazuh/agents/byid/:id/user/:userId", async (req, res) => {
  const { id, userId } = req.params;

  try {
    // Cek agent di database
    const existing = await prisma.wazuhAgent.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: "Agent not found" });
    }

    // Ambil agentId real dari Wazuh pakai nama
    let agentId = existing.agentId;
    try {
      const wazuhRes = await fetch(
        `${process.env.WAZUH_API_URL}/agents?name=${encodeURIComponent(existing.name)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
          },
          agent: insecureAgent,
        }
      );

      if (wazuhRes.ok) {
        const data = await wazuhRes.json();
        const w = data?.data?.affected_items?.[0];
        agentId = w?.id || existing.agentId;
      }
    } catch (err) {
      console.warn("⚠️ Error fetching agent from Wazuh:", err.message);
    }

    // Hapus dari Wazuh kalau ada agentId
    if (agentId) {
      try {
        const delRes = await fetch(
          `${process.env.WAZUH_API_URL}/agents?agents_list=${agentId}&status=all&older_than=0s`,
          {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
            },
            agent: insecureAgent,
          }
        );

        if (delRes.ok) {
          console.log(`✅ Agent ${agentId} deleted from Wazuh`);
        } else {
          console.warn(`⚠️ Failed to delete agent ${agentId} from Wazuh: ${delRes.status} - ${await delRes.text()}`);
        }
      } catch (err) {
        console.warn("⚠️ Failed delete from Wazuh:", err.message);
      }
    }

    // Hapus dari database
    await prisma.wazuhAgent.delete({ where: { id } });

    res.json({ ok: true, agentIdDeleted: agentId });
  } catch (error) {
    console.error("Error deleting agent:", error.message);
    res.status(500).json({ error: "Failed to delete agent" });
  }
});


// Metrics (dari DB cached, dengan fallback API jika butuh fresh)
app.get("/api/wazuh/agents/:identifier/metrics/user/:userId", async (req, res) => {
  const { identifier, userId } = req.params;
  const { limit = 20, from, to } = req.query; // Support limit & time range untuk grafik
  try {
    const agent = await prisma.wazuhAgent.findFirst({
      where: {
        OR: [{ name: identifier }, { ip: identifier }, { id: identifier }]
      }
    });
    if (!agent || agent.userId !== userId) return res.status(404).json({ error: "Agent not found" });

    // Query DB dengan filter time range jika ada
    let whereClause = { wazuhAgentId: agent.id };
    if (from || to) {
      whereClause.collectedAt = {};
      if (from) whereClause.collectedAt.gte = new Date(from);
      if (to) whereClause.collectedAt.lte = new Date(to);
    }

    const metrics = await prisma.wazuhAgentMetric.findMany({
      where: whereClause,
      orderBy: { collectedAt: "desc" },
      take: parseInt(limit),
    });

    // Jika DB kosong (<5 data), fallback fetch fresh dari API dan simpan
    if (metrics.length < 5) {
      // Fetch fresh seperti sebelumnya, lalu create ke DB
      // ... (kode fetch API dari respons sebelumnya)
      // await prisma.wazuhAgentMetric.create({ data: { ... } });
      // Kemudian query ulang metrics
    }

    // Format untuk grafik: e.g., array { timestamp: collectedAt, cpu: cpuUsage, ... }
    const formattedMetrics = metrics.map(m => ({
      timestamp: m.collectedAt,
      cpuUsage: m.cpuUsage,
      memoryUsage: m.memoryUsage,
      diskUsage: m.diskUsage
    }));

    res.json({
      metrics: formattedMetrics,
      summary: {
        total: metrics.length,
        avgCpu: metrics.reduce((sum, m) => sum + (m.cpuUsage || 0), 0) / metrics.length || 0
      }
    });
  } catch (error) {
    console.error("Error fetching metrics:", error.message);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});


// Logs/Alerts (dari Wazuh API dengan time range)
app.get("/api/wazuh/agents/:identifier/logs/user/:userId", async (req, res) => {
  const { identifier, userId } = req.params;
  const { limit = 50, from, to, severity } = req.query; // Support range & filter
  try {
    const agent = await prisma.wazuhAgent.findFirst({
      where: {
        OR: [{ name: identifier }, { ip: identifier }, { id: identifier }]
      }
    });
    if (!agent || agent.userId !== userId) return res.status(404).json({ error: "Agent not found" });

    const agentId = agent.agentId;

    // Build query Wazuh: filter by agent, time range, severity (jika ada)
    let queryParams = `agent.id=${agentId}&limit=${limit}&sort=-timestamp&select=*,agent.name,agent.ip,rule.level,timestamp,rule.description`;
    if (from || to) {
      const q = `q='rule.level>=1';timestamp>=[${from || 'now-1h'}]`;
      if (to) q += ` AND timestamp<=['${to}']`;
      if (severity) q += ` AND rule.level==${severity}`;
      queryParams += `&q=${encodeURIComponent(q)}`;
    }

    const logsRes = await fetch(
      `${process.env.WAZUH_API_URL}/alerts?${queryParams}`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}` },
        agent,
      }
    );

    if (!logsRes.ok) {
      const errText = await logsRes.text();
      throw new Error(`Wazuh API error: ${logsRes.status} ${logsRes.statusText} - ${errText}`);
    }

    const logs = await logsRes.json();

    // Process untuk grafik: e.g., count per jam/severity
    const hourlyCounts = {}; // Untuk bar chart per jam
    const severityCounts = {};
    logs.data?.affected_items.forEach(log => {
      const hour = new Date(log.timestamp).toISOString().split('T')[0] + ' ' + new Date(log.timestamp).getHours();
      hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1;
      
      const sev = log.rule?.level || 'unknown';
      severityCounts[sev] = (severityCounts[sev] || 0) + 1;
    });

    res.json({
      logs: logs?.data?.affected_items || [], // Raw data
      summary: {
        total: logs?.data?.affected_items?.length || 0,
        severityCounts, // Pie chart
        hourlyCounts, // Bar chart per jam
        agentInfo: { name: agent.name, ip: agent.ip }
      }
    });
  } catch (error) {
    console.error("Error fetching agent logs:", error.message);
    res.status(500).json({ error: "Failed to fetch agent logs" });
  }
});


// Vulnerabilities (dari DB, cached)
app.get("/api/wazuh/agents/:identifier/vulnerabilities/user/:userId", async (req, res) => {
  const { identifier, userId } = req.params;
  try {
    // Cari agent di DB berdasarkan identifier (name, ip, atau id)
    const agent = await prisma.wazuhAgent.findFirst({
      where: {
        OR: [
          { name: identifier },
          { ip: identifier },
          { id: identifier } // Fallback untuk DB id
        ]
      }
    });
    if (!agent || agent.userId !== userId) return res.status(404).json({ error: "Agent not found" });

    const vulns = await prisma.wazuhAgentVulnerability.findMany({
      where: { wazuhAgentId: agent.id }, // Gunakan DB id
      orderBy: { createdAt: "desc" },
    });
    res.json(vulns);
  } catch (error) {
    console.error("Error fetching vulnerabilities:", error.message);
    res.status(500).json({ error: "Failed to fetch vulnerabilities" });
  }
});

// Compliance (dari DB, cached)
app.get("/api/wazuh/agents/:identifier/compliance/user/:userId", async (req, res) => {
  const { identifier, userId } = req.params;
  try {
    // Cari agent di DB berdasarkan identifier (name, ip, atau id)
    const agent = await prisma.wazuhAgent.findFirst({
      where: {
        OR: [
          { name: identifier },
          { ip: identifier },
          { id: identifier } // Fallback untuk DB id
        ]
      }
    });
    if (!agent || agent.userId !== userId) return res.status(404).json({ error: "Agent not found" });

    const compliance = await prisma.wazuhAgentCompliance.findUnique({
      where: { wazuhAgentId: agent.id }, // Gunakan DB id
    });
    res.json(compliance || {});
  } catch (error) {
    console.error("Error fetching compliance:", error.message);
    res.status(500).json({ error: "Failed to fetch compliance" });
  }
});

// ====== GET metrics agent dari Wazuh API (fresh data, divalidasi via DB) ======
app.get("/api/wazuh/agents/:identifier/metrics/user/:userId", async (req, res) => {
  const { identifier, userId } = req.params;
  try {
    // Cari agent di DB berdasarkan identifier (name, ip, atau id)
    const agent = await prisma.wazuhAgent.findFirst({
      where: {
        OR: [
          { name: identifier },
          { ip: identifier },
          { id: identifier } // Fallback untuk DB id
        ]
      }
    });
    if (!agent || agent.userId !== userId) return res.status(404).json({ error: "Agent not found" });

    const agentId = agent.agentId; // Gunakan Wazuh agentId untuk API call

    // Ambil hardware dari Wazuh API
    const wazuhRes = await fetch(
      `${process.env.WAZUH_API_URL}/syscollector/${agentId}/hardware`, 
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
        },
        agent,
      }
    );

    if (!wazuhRes.ok) {
      const errText = await wazuhRes.text();
      throw new Error(
        `Wazuh API error: ${wazuhRes.status} ${wazuhRes.statusText} - ${errText}`
      );
    }

    const hardware = await wazuhRes.json();

    // CPU
    const cpuRes = await fetch(
      `${process.env.WAZUH_API_URL}/syscollector/${agentId}/cpu`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}` },
        agent,
      }
    );
    const cpu = await cpuRes.json();

    // Memory
    const memRes = await fetch(
      `${process.env.WAZUH_API_URL}/syscollector/${agentId}/memory`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}` },
        agent,
      }
    );
    const memory = await memRes.json();

    // Disk (gunakan hotfixes sebagai proxy untuk disk-related, atau ganti ke /packages jika butuh)
    const diskRes = await fetch(
      `${process.env.WAZUH_API_URL}/syscollector/${agentId}/hotfixes`, 
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}` },
        agent,
      }
    );
    const disk = await diskRes.json();

    // Bentuk response ke frontend (cocok untuk grafik: e.g., CPU usage over time)
    res.json({
      cpu: cpu?.data?.affected_items || [],
      memory: memory?.data?.affected_items || [],
      disk: disk?.data?.affected_items || [],
      hardware: hardware?.data?.affected_items || [],
    });
  } catch (error) {
    console.error("Error fetching agent metrics:", error.message);
    res.status(500).json({ error: "Failed to fetch agent metrics" });
  }
});

// ====== ENDPOINT BARU: GET logs/alerts dari Wazuh API (untuk tampilkan log dalam grafik/data) ======
app.get("/api/wazuh/agents/:identifier/logs/user/:userId", async (req, res) => {
  const { identifier, userId } = req.params;
  try {
    // Cari agent di DB berdasarkan identifier (name, ip, atau id)
    const agent = await prisma.wazuhAgent.findFirst({
      where: {
        OR: [
          { name: identifier },
          { ip: identifier },
          { id: identifier } // Fallback untuk DB id
        ]
      }
    });
    if (!agent || agent.userId !== userId) return res.status(404).json({ error: "Agent not found" });

    const agentId = agent.agentId; // Gunakan Wazuh agentId untuk API call

    // Fetch logs/alerts dari Wazuh API (filter by agent.id, limit 20 terbaru, sort desc timestamp)
    // Query params: q='agent.id:${agentId}' untuk filter, limit=20, sort=-timestamp
    const logsRes = await fetch(
      `${process.env.WAZUH_API_URL}/alerts?agent.id=${agentId}&limit=20&sort=-timestamp&select=*,agent.name,agent.ip,rule.level,timestamp,data.srcip,data.dstip,rule.description`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${process.env.WAZUH_API_TOKEN}`,
        },
        agent,
      }
    );

    if (!logsRes.ok) {
      const errText = await logsRes.text();
      throw new Error(
        `Wazuh API error: ${logsRes.status} ${logsRes.statusText} - ${errText}`
      );
    }

    const logs = await logsRes.json();

    // Optional: Process untuk grafik (e.g., group by severity untuk pie chart, atau timeline untuk line chart)
    // Contoh: Hitung count per severity
    const severityCounts = {};
    logs.data?.affected_items.forEach(log => {
      const severity = log.rule?.level || 'unknown';
      severityCounts[severity] = (severityCounts[severity] || 0) + 1;
    });

    // Bentuk response: Raw logs + summary untuk data/grafik
    res.json({
      logs: logs?.data?.affected_items || [], // Array logs lengkap (timestamp, message, severity, srcip, dll.)
      summary: {
        total: logs?.data?.affected_items?.length || 0,
        severityCounts, // e.g., { low: 5, high: 3, ... } untuk pie chart
        agentInfo: { name: agent.name, ip: agent.ip }
      }
    });
  } catch (error) {
    console.error("Error fetching agent logs:", error.message);
    res.status(500).json({ error: "Failed to fetch agent logs" });
  }
});


/* ==================== START SERVER ==================== */
app.listen(PORT, () => {
  console.log(`✅ Server backend berjalan di http://localhost:${PORT}`);
});

//corn prtg
import cron from "node-cron";

// scheduler ambil data PRTG
cron.schedule("*/2 * * * *", async () => {
  console.log("⏳ Ambil data sensor dari PRTG...");
  try {
    const sensors = await prisma.sensor.findMany();

    for (const sensor of sensors) {
      const response = await axios.get(
        `${process.env.PRTG_HOST}/api/getsensordetails.json`,
        {
          params: {
            id: sensor.prtgId,
            username: process.env.PRTG_USERNAME,
            passhash: process.env.PRTG_PASSHASH,
          },
        }
      );

      const prtgData = response.data.sensordata;

      await prisma.sensorLog.create({
        data: {
          sensorId: sensor.id,
          value: parseFloat(prtgData.lastvalue_raw) || 0,
          message: prtgData.lastmessage || "",
        },
      });

      await prisma.sensor.update({
        where: { id: sensor.id },
        data: {
          lastValue: parseFloat(prtgData.lastvalue_raw) || 0,
          message: prtgData.lastmessage || "",
          status: String(prtgData.status_raw || "0"),
        },
      });
    }

    console.log("✅ Data sensor berhasil diperbarui");
  } catch (err) {
    console.error("❌ Error ambil data PRTG:", err.message);
  }
});

//corn wazuh
// scheduler: Fetch metrics untuk semua agent active setiap 5 menit
cron.schedule("*/5 * * * *", async () => {
  console.log("Running metrics cron job...");
  try {
    const agents = await prisma.wazuhAgent.findMany({
      where: { status: "active" },
    });

    for (const ag of agents) {
      const agentId = ag.agentId;

      try {
        // === CPU ===
        const cpuRes = await fetch(
          `${process.env.WAZUH_API_URL}/syscollector/${agentId}/cpu`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${process.env.WAZUH_API_TOKEN}` },
            agent: insecureAgent,
          }
        );

        if (!cpuRes.ok) {
          console.error(`❌ CPU fetch failed for ${ag.name}:`, await cpuRes.text());
          continue;
        }

        const cpuData = await cpuRes.json();
        const cpuUsage =
          cpuData?.data?.affected_items?.[0]?.cpu?.usage ?? 0;

        // === Memory ===
        const memRes = await fetch(
          `${process.env.WAZUH_API_URL}/syscollector/${agentId}/memory`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${process.env.WAZUH_API_TOKEN}` },
            agent: insecureAgent,
          }
        );

        let memoryUsage = 0;
        if (memRes.ok) {
          const memData = await memRes.json();
          const totalMem = memData?.data?.affected_items?.[0]?.total || 0;
          const usedMem = memData?.data?.affected_items?.[0]?.used || 0;
          memoryUsage = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
        }

        // === Disk ===
        const diskRes = await fetch(
          `${process.env.WAZUH_API_URL}/syscollector/${agentId}/os`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${process.env.WAZUH_API_TOKEN}` },
            agent: insecureAgent,
          }
        );

        let diskUsage = 0;
        if (diskRes.ok) {
          const diskData = await diskRes.json();
          diskUsage =
            diskData?.data?.affected_items?.[0]?.disk_usage || 0;
        }

        // === Save to DB ===
        await prisma.wazuhAgentMetric.create({
          data: {
            cpuUsage,
            memoryUsage,
            diskUsage,
            wazuhAgentId: ag.id,
          },
        });

        console.log(`✅ Metrics saved for agent ${ag.name}`);
      } catch (err) {
        console.error(`⚠️ Error fetching metrics for ${ag.name}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Cron job error:", error.message);
  }
});

