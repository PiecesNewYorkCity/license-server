require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch(err => console.error(err));

// License Schema
const LicenseSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    maxActivations: { type: Number, default: 3 },
    activations: { type: Number, default: 0 },
    isValid: { type: Boolean, default: true },
});
const License = mongoose.model("License", LicenseSchema);

// Generate License Key
app.post("/generate-license", async (req, res) => {
    const { userId } = req.body;
    const newLicense = new License({ key: generateKey(), userId });
    await newLicense.save();
    res.json({ licenseKey: newLicense.key });
});
function generateKey() {
    return "LIC-" + Math.random().toString(36).substr(2, 16).toUpperCase();
}

// Verify License Key
app.post("/verify-license", async (req, res) => {
    const { key, deviceId } = req.body;
    const license = await License.findOne({ key });

    if (!license || !license.isValid) {
        return res.status(400).json({ valid: false, message: "Invalid License" });
    }

    if (license.activations >= license.maxActivations) {
        return res.status(403).json({ valid: false, message: "Activation Limit Reached" });
    }

    license.activations += 1;
    await license.save();
    res.json({ valid: true, message: "License Verified" });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
