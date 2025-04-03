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
    email: { type: String, required: true }, // Store email for reference
    maxActivations: { type: Number, default: 3 },
    activations: { type: Number, default: 0 },
    isValid: { type: Boolean, default: true },
});
const License = mongoose.model("License", LicenseSchema);

// Generate License Key
app.post("/generate-license", async (req, res) => {
    const { userId, email } = req.body;
    const newLicense = new License({ key: generateKey(), userId, email });
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

// Square Webhook Endpoint (Handles Payments)
app.post("/square-webhook", async (req, res) => {
    try {
        const event = req.body;
        console.log("🔔 Webhook Event Received:", event);

        if (event.type === "payment.created") {
            const payment = event.data.object;
            const email = payment.buyer_email_address; // Extract buyer's email

            console.log("✅ Payment Confirmed for Email:", email);

            // Generate a license key for this email
            const newLicense = new License({ key: generateKey(), userId: email, email });
            await newLicense.save();

            console.log("🎟️ License Generated:", newLicense.key);
        }

        res.status(200).send("Webhook received");
    } catch (error) {
        console.error("❌ Error processing Square Webhook:", error);
        res.status(500).send("Internal Server Error");
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
