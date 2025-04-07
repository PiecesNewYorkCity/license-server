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
    <p>Your license key:</p>
    <pre style="font-size: 18px; background: #eee; padding: 10px;">${keyList}</pre>
    <p>Enter this in the game to activate your copy.</p>
    <p>— Pieces</p>
  `;

  await transporter.sendMail({
    from: `"Pieces" <${process.env.GMAIL_USER}>`,
    to,
    subject: `Your License Key for ${product}`,
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

            // 🔍 Extract customer email/name from Customer Information section
            const customerSection = body.match(/Customer Information([\s\S]*?)Order Summary/i);
            const customerEmailMatch = customerSection?.[1]?.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            const customerNameLine = customerSection?.[1]?.split(/\n|,/).map(l => l.trim()).filter(Boolean)?.[0];

            const buyerEmail = customerEmailMatch?.[1]?.trim() || parsed.from?.value?.[0]?.address || "unknown@example.com";
            const buyerName = customerNameLine || parsed.from?.value?.[0]?.name || "Customer";

            // 🧾 Flexible Order ID matcher with fallback to subject line
            const orderIdMatch = body.match(/Order\s*(?:No\.?|#:?)?\s*(\d{5,})/i) || parsed.subject?.match(/#(\d{5,})/);
            const orderId = orderIdMatch?.[1]?.trim();

            // 🛍 Check if "Land of Love" is present in order summary
            const orderSummaryMatch = body.match(/Item Desc\s+Quantity\s+Total([\s\S]*?)Subtotal/i);
            let landOfLoveFound = false;

            if (orderSummaryMatch?.[1]) {
              const lines = orderSummaryMatch[1]
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);

              console.log("📦 Raw Order Summary Lines:");
              lines.forEach((line, i) => {
                console.log(`${i}: ${JSON.stringify(line)}`);
              });

              for (let line of lines) {
                if (/land of love/i.test(line)) {
                  landOfLoveFound = true;
                  console.log("🧪 Found 'Land of Love' in line:", line);
                  break;
                }
              }
            }

            // ✅ Log values to confirm parsing success
            console.log("🔎 Check values:");
            console.log("Order ID:", orderId);
            console.log("Email:", buyerEmail);
            console.log("Name:", buyerName);
            console.log("Found Land of Love:", landOfLoveFound);

            if (!buyerEmail || !orderId || !landOfLoveFound) {
              console.log("⚠️ Could not extract valid order or product.");
              return;
            }

            console.log("📬 New email from:", from);
            console.log("🧾 Order #:", orderId);
            console.log("🧑 Customer:", buyerName);
            console.log("📧 Email:", buyerEmail);

            const licenseKeys = [];
            const subOrderId = `${orderId}-1`;

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
                console.log(`♻️ License already exists for ${subOrderId}. Skipping email.`);
              } else {
                console.log(`🎟️ License key generated: ${licenseKey}`);
                licenseKeys.push(licenseKey);
                await sendLicenseEmail(buyerEmail, buyerName, licenseKeys, "Land of Love");
              }
            } catch (err) {
              if (err.response) {
                console.error("❌ License generation failed:", err.response.status, err.response.data);
              } else {
                console.error("❌ License generation failed:", err.message);
              }
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
