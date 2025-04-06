require("dotenv").config();
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const nodemailer = require("nodemailer");

const imap = new Imap({
  user: process.env.GMAIL_USER,
  password: process.env.GMAIL_PASS,
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
});

function openInbox(cb) {
  imap.openBox("INBOX", false, cb);
}

async function sendLicenseEmail(to, name, licenseKeys, product) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  const keyList = licenseKeys.map((k, i) => `${i + 1}. ${k}`).join("<br>");

  const html = `
    <h2>Hi ${name || "there"},</h2>
    <p>Thanks for your purchase of <strong>${product}</strong>!</p>
    <p>Here ${licenseKeys.length === 1 ? "is" : "are"} your license key${licenseKeys.length > 1 ? "s" : ""}:</p>
    <pre style="font-size: 18px; background: #eee; padding: 10px;">${keyList}</pre>
    <p>Use each key to activate a copy of the game.</p>
    <p>— Your Game Team</p>
  `;

  await transporter.sendMail({
    from: `"Your Game Store" <${process.env.GMAIL_USER}>`,
    to,
    subject: `Your License Key(s) for ${product}`,
    html,
  });

  console.log("📤 License email sent to:", to);
}

imap.once("ready", () => {
  openInbox((err, box) => {
    if (err) throw err;

    imap.search(["UNSEEN"], (err, results) => {
      if (err || !results || results.length === 0) {
        console.log("📭 No unread emails.");
        imap.end();
        return;
      }

      const f = imap.fetch(results, { bodies: "" });

      f.on("message", msg => {
        msg.on("body", stream => {
          simpleParser(stream, async (err, parsed) => {
            if (err) {
              console.error("❌ Mail parsing error:", err);
              return;
            }

            const body = parsed.text || "";
            const from = parsed.from?.text;

            const customerSection = body.match(/Customer Information([\s\S]*?)Order Summary/i);
            const customerEmailMatch = customerSection?.[1]?.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            const buyerEmail = customerEmailMatch?.[1]?.trim();

            let buyerName = null;
            if (customerSection?.[1]) {
              const lines = customerSection[1].split(/\n|,/).map(l => l.trim()).filter(Boolean);
              buyerName = lines[0];
            }

            const orderIdMatch = body.match(/Order\s*(?:No\.?|#:?)\s*(\d+)/i);
            const orderId = orderIdMatch?.[1]?.trim();

            // 🛍 Parse all product lines from order summary
            const orderSummaryMatch = body.match(/Item Desc\s+Quantity\s+Total([\s\S]*?)Subtotal/i);
            let landOfLoveQuantity = 0;

            if (orderSummaryMatch?.[1]) {
              const lines = orderSummaryMatch[1]
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean);

              for (let i = 0; i < lines.length; i++) {
                if (/land of love/i.test(lines[i])) {
                  const qtyLine = lines[i + 1]?.trim();
                  const qtyMatch = qtyLine?.match(/^(\d+)/);
                  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                  landOfLoveQuantity = qty;
                  break;
                }
              }
            }

            if (!buyerEmail || !orderId || landOfLoveQuantity === 0) {
              console.log("⚠️ Could not extract valid product or quantity.");
              return;
            }

            console.log("📬 New email from:", from);
            console.log("🧾 Order #:", orderId);
            console.log("🧑 Customer:", buyerName);
            console.log("📧 Email:", buyerEmail);
            console.log(`🎯 Land of Love Quantity: ${landOfLoveQuantity}`);

            const licenseKeys = [];

            for (let i = 0; i < landOfLoveQuantity; i++) {
              const subOrderId = `${orderId}-${i + 1}`;

              console.log("📡 Calling:", process.env.LICENSE_API);
              console.log("📦 Payload:", {
                userId: subOrderId,
                email: buyerEmail,
                name: buyerName,
              });

              try {
                const response = await axios.post(process.env.LICENSE_API, {
                  userId: subOrderId,
                  email: buyerEmail,
                  name: buyerName,
                });

                const { licenseKey, existing } = response.data;

                if (existing) {
                  console.log(`♻️ License already exists for ${subOrderId}. Skipping.`);
                } else {
                  console.log(`🎟️ License key generated for ${subOrderId}: ${licenseKey}`);
                  licenseKeys.push(licenseKey);
                }
              } catch (err) {
                if (err.response) {
                  console.error("❌ License generation failed:", err.response.status, err.response.data);
                } else {
                  console.error("❌ License generation failed:", err.message);
                }
              }
            }

            if (licenseKeys.length > 0) {
              await sendLicenseEmail(buyerEmail, buyerName, licenseKeys, "Land of Love");
            } else {
              console.log("🚫 No new licenses generated. Email not sent.");
            }
          });
        });
      });

      f.once("end", () => {
        console.log("✅ Done checking unread emails.");
        imap.end();
      });
    });
  });
});

imap.once("error", err => {
  console.error("❌ IMAP Error:", err);
});

imap.once("end", () => {
  console.log("📪 IMAP connection closed.");
});

imap.connect();
