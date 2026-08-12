#!/usr/bin/env node
/**
 * Seed sample inquiries (leads) and matching chat sessions for local development.
 * Usage: node scripts/seedSampleInquiries.js [userId]
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_USER_ID = "user_d43ca403-11dd-45c6-8888-30a2fe9f4930";
const userId = (process.argv[2] || DEFAULT_USER_ID).trim();

const dataDir = path.join(__dirname, "..", "data", userId);
const leadsPath = path.join(dataDir, "leads.json");
const chatsPath = path.join(dataDir, "chats.json");

const now = Date.now();
const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

const SAMPLE_INQUIRIES = [
  {
    id: "sample-lead-001",
    conversationId: "sample_inquiry_web_001",
    session: {
      chatSource: "web",
      channelAccountName: "",
    },
    fieldLabels: ["Full Name", "Email", "Phone", "Company"],
    collectedData: {
      "Full Name": "Sarah Mitchell",
      Email: "sarah.mitchell@acmecorp.com",
      Phone: "+1 555-0142",
      Company: "Acme Corp",
    },
    createdAt: daysAgo(6),
    updatedAt: daysAgo(5),
    exported: false,
  },
  {
    id: "sample-lead-002",
    conversationId: "sample_inquiry_whatsapp_001",
    session: {
      chatSource: "whatsapp",
      channelAccountName: "Nicke - Government Exam Helper",
      whatsappAccountId: "1",
      whatsappPeerPhone: "+94771234567",
    },
    fieldLabels: ["Full Name", "Email", "Phone"],
    collectedData: {
      "Full Name": "Rajesh Kumar",
      Email: "rajesh.kumar@gmail.com",
      Phone: "+94 77 123 4567",
    },
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
    exported: false,
  },
  {
    id: "sample-lead-003",
    conversationId: "sample_inquiry_whatsapp_002",
    session: {
      chatSource: "whatsapp",
      channelAccountName: "Ai Pulse.tech",
      whatsappAccountId: "2",
      whatsappPeerPhone: "+94777654321",
    },
    fieldLabels: ["Full Name", "Email", "Phone", "Service Interest"],
    collectedData: {
      "Full Name": "Emma Wilson",
      Email: "emma.w@designstudio.io",
      Phone: "+44 7700 900123",
      "Service Interest": "Website redesign",
    },
    createdAt: daysAgo(3),
    updatedAt: daysAgo(2),
    exported: true,
    exportedAt: daysAgo(2),
  },
  {
    id: "sample-lead-004",
    conversationId: "sample_inquiry_testbot_001",
    session: {
      chatSource: "test_bot",
      channelAccountName: "",
    },
    fieldLabels: ["Full Name", "Email", "Phone"],
    collectedData: {
      "Full Name": "James Chen",
      Email: "j.chen@startup.dev",
      Phone: "+65 9123 4567",
    },
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
    exported: false,
  },
  {
    id: "sample-lead-005",
    conversationId: "sample_inquiry_web_002",
    session: {
      chatSource: "web",
      channelAccountName: "",
    },
    fieldLabels: ["Full Name", "Email", "Phone", "Budget"],
    collectedData: {
      "Full Name": "Priya Sharma",
      Email: "priya.sharma@outlook.com",
      Phone: "+91 98765 43210",
      Budget: "$5,000 – $10,000",
    },
    createdAt: daysAgo(1),
    updatedAt: daysAgo(0),
    exported: false,
  },
  {
    id: "sample-lead-006",
    conversationId: "sample_inquiry_whatsapp_003",
    session: {
      chatSource: "whatsapp",
      channelAccountName: "Nicke - Government Exam Helper",
      whatsappAccountId: "1",
      whatsappPeerPhone: "+94769876543",
    },
    fieldLabels: ["Full Name", "Email", "Mobile"],
    collectedData: {
      "Full Name": "Michael Brown",
      Email: "mbrown@consulting.com",
      Mobile: "+1 555-0199",
    },
    createdAt: daysAgo(7),
    updatedAt: daysAgo(6),
    exported: true,
    exportedAt: daysAgo(5),
  },
  {
    id: "sample-lead-007",
    conversationId: "sample_inquiry_testbot_002",
    session: {
      chatSource: "test_bot",
      channelAccountName: "",
    },
    fieldLabels: ["Full Name", "Email", "Contact Number"],
    collectedData: {
      "Full Name": "Lisa Anderson",
      Email: "lisa.anderson@health.org",
      "Contact Number": "+61 412 345 678",
    },
    createdAt: daysAgo(5),
    updatedAt: daysAgo(4),
    exported: false,
  },
  {
    id: "sample-lead-008",
    conversationId: "sample_inquiry_web_003",
    session: {
      chatSource: "web",
      channelAccountName: "",
    },
    fieldLabels: ["Full Name", "Email", "Phone", "Message"],
    collectedData: {
      "Full Name": "David Okonkwo",
      Email: "david.o@enterprise.ng",
      Phone: "+234 803 123 4567",
      Message: "Interested in enterprise plan pricing",
    },
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    exported: false,
  },
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildLead(sample) {
  const lead = {
    id: sample.id,
    userId,
    conversationId: sample.conversationId,
    fieldLabels: sample.fieldLabels,
    collectedData: sample.collectedData,
    collectedCount: Object.keys(sample.collectedData).length,
    createdAt: sample.createdAt,
    updatedAt: sample.updatedAt,
  };
  if (sample.exported) {
    lead.exported = true;
    lead.exportedAt = sample.exportedAt || sample.updatedAt;
  }
  return lead;
}

function buildSession(sample) {
  const { session } = sample;
  const name = sample.collectedData["Full Name"] || "Visitor";
  return {
    id: `sample-session-${sample.id}`,
    userId,
    conversationId: sample.conversationId,
    account: { id: userId, username: "sample", email: "sample@example.com" },
    chatSource: session.chatSource,
    channelAccountName: session.channelAccountName || "",
    ...(session.whatsappAccountId
      ? {
          whatsappAccountId: session.whatsappAccountId,
          whatsappPeerPhone: session.whatsappPeerPhone || "",
          whatsappChatId: `${session.whatsappPeerPhone?.replace(/\D/g, "") || "0000000000"}@c.us`,
        }
      : {}),
    messages: [
      {
        role: "user",
        content: `Hi, I'd like to get in touch. My name is ${name}.`,
        createdAt: sample.createdAt,
      },
      {
        role: "assistant",
        content: "Thanks! Could you share your email and phone number so we can follow up?",
        createdAt: sample.updatedAt,
      },
    ],
    messageCount: 2,
    liveAgentEnabled: false,
    lastReplyPreview: "Thanks! Could you share your email and phone number so we can follow up?",
    createdAt: sample.createdAt,
    updatedAt: sample.updatedAt,
  };
}

function main() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const leadsStore = readJson(leadsPath, { leads: [] });
  const existingLeadIds = new Set((leadsStore.leads || []).map((l) => l.id));
  const existingConvIds = new Set((leadsStore.leads || []).map((l) => l.conversationId));

  const newLeads = SAMPLE_INQUIRIES.filter(
    (s) => !existingLeadIds.has(s.id) && !existingConvIds.has(s.conversationId)
  ).map(buildLead);

  if (!newLeads.length) {
    console.log("Sample inquiries already seeded — nothing to add.");
    return;
  }

  leadsStore.leads = [...newLeads, ...(leadsStore.leads || [])];
  fs.writeFileSync(leadsPath, JSON.stringify(leadsStore, null, 2), "utf8");

  const chatsStore = readJson(chatsPath, { sessions: [] });
  const existingSessionConvIds = new Set(
    (chatsStore.sessions || []).map((s) => s.conversationId)
  );

  const newSessions = SAMPLE_INQUIRIES.filter(
    (s) =>
      newLeads.some((l) => l.id === s.id) && !existingSessionConvIds.has(s.conversationId)
  ).map(buildSession);

  chatsStore.sessions = [...newSessions, ...(chatsStore.sessions || [])];
  fs.writeFileSync(chatsPath, JSON.stringify(chatsStore, null, 2), "utf8");

  console.log(`Seeded ${newLeads.length} sample inquiries for ${userId}`);
  newLeads.forEach((lead) => {
    const name = lead.collectedData["Full Name"] || lead.id;
    console.log(`  • ${name} (${lead.conversationId})`);
  });
}

main();
