require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Error:", err));

// Updated schema with deviceIds
const LicenseSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  email: { type: String, required: true },
  name: { type: String },
  maxActivations: { type: Number, default: 3 },
  activations: { type: Number, default: 0 },
  isValid: { type: Boolean, default: true },
  deviceIds: [String], // ✅ NEW FIELD
});

const License = mongoose.model("License", LicenseSchema);

// Generate license
app.post("/generate-license", async (req, res) => {
  const { userId, email, name } = req.body;

  const existing = await License.findOne({ userId, email });
  if (existing) {
    return res.json({ licenseKey: existing.key, existing: true });
  }

  const newLicense = new License({
    key: generateKey(),
    userId,
    email,
    name,
    deviceIds: [],
  });

  await newLicense.save();
  res.json({ licenseKey: newLicense.key });
});

function generateKey() {
  return "LIC-" + Math.random().toString(36).substr(2, 16).toUpperCase();
}

// ✅ Improved license verification with per-device tracking
app.post("/verify-license", async (req, res) => {
  try {
    const { key, deviceId } = req.body || {};

    console.log("🔍 Incoming verify request:", req.body);

    if (!key || !deviceId) {
      return res.status(400).json({ valid: false, message: "Missing key or device ID." });
    }

    const license = await License.findOne({ key });

    if (!license || !license.isValid) {
      return res.status(400).json({ valid: false, message: "Invalid or deactivated license key." });
    }

    if (!license.deviceIds.includes(deviceId)) {
      if (license.activations >= license.maxActivations) {
        console.log("❌ Activation limit reached for key:", key);
        return res.status(403).json({ valid: false, message: "Activation limit reached." });
      }

      license.deviceIds.push(deviceId);
      license.activations += 1;
      await license.save();

      console.log(`✅ New device activated. Total activations: ${license.activations}`);
    } else {
      console.log("✅ Device already verified — no activation used.");
    }

    return res.json({ valid: true, message: "License verified." });
  } catch (err) {
    console.error("❌ Server error on /verify-license:", err);
    res.status(500).json({ valid: false, message: "Server error." });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
