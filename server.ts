import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { Issue } from "./src/types";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = 3000;

// Lazy initialization of Gemini client
let aiInstance: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// In-memory data store for issues
let issues: Issue[] = [
  {
    id: "CIV-301",
    title: "Major Pipe Burst in Sector 15",
    category: "Water Leakage",
    location: "Sector 15, Near Central Park",
    description: "A large high-pressure water transmission pipeline has ruptured, sending a massive geyser of water into the air and flooding the roadway and nearby footpaths.",
    urgency: "High",
    upvotes: 18,
    status: "In Progress",
    date: "2026-06-28",
    isAnonymous: false,
    reporterName: "Ganesh Gorad",
    imageUrl: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=400&q=80",
    timelineUpdates: [
      { status: "Received", date: "2026-06-28", comment: "Reported by Ganesh Gorad." },
      { status: "Site Inspection", date: "2026-06-28", comment: "Verified high urgency pipe burst." },
      { status: "Team Assigned", date: "2026-06-28", comment: "Dispatched Crew Bravo for heavy machinery operations." },
      { status: "In Progress", date: "2026-06-28", comment: "Crew Bravo is on-site repairing the pipe main." }
    ]
  },
  {
    id: "CIV-302",
    title: "Drainage Overflow on Station Road",
    category: "Water Leakage",
    location: "Station Road, Opp Railway",
    description: "Raw sewage and dirty water overflowing from multiple manholes near the railway station entrance, creating a terrible smell and traffic gridlock.",
    urgency: "High",
    upvotes: 9,
    status: "Team Assigned",
    date: "2026-06-28",
    isAnonymous: false,
    reporterName: "Siddharth Shah",
    imageUrl: "https://images.unsplash.com/photo-1542282088-fe8426682b8f?auto=format&fit=crop&w=400&q=80",
    timelineUpdates: [
      { status: "Received", date: "2026-06-28", comment: "Reported by Siddharth Shah." },
      { status: "Site Inspection", date: "2026-06-28", comment: "Drainage team verified street overflow." },
      { status: "Team Assigned", date: "2026-06-28", comment: "Assigned Crew Alpha to clear the blockage." }
    ]
  },
  {
    id: "CIV-303",
    title: "Contaminated Water Supply",
    category: "Water Leakage",
    location: "Sector 15, Residential Block C",
    description: "Drinking water in Block C has a yellow-brown tint and a slight metallic smell. Multiple residents reported the same issue this morning.",
    urgency: "Medium",
    upvotes: 4,
    status: "Received",
    date: "2026-06-28",
    isAnonymous: false,
    reporterName: "Neha Sharma",
    imageUrl: "https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&w=400&q=80",
    timelineUpdates: [
      { status: "Received", date: "2026-06-28", comment: "Reported by Neha Sharma. Awaiting municipal triage." }
    ]
  }
];

// Helper to generate IDs
let issueCounter = 1026;
function generateIssueId() {
  const id = `CIV-${issueCounter}`;
  issueCounter++;
  return id;
}

// REST Endpoints
app.get("/api/issues", (req, res) => {
  res.json(issues);
});

app.post("/api/issues", (req, res) => {
  const { title, category, location, description, urgency, isAnonymous, reporterName, imageUrl } = req.body;
  
  if (!title || !category || !location || !description || !urgency) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const currentDate = new Date().toISOString().split('T')[0];
  const newIssue: Issue = {
    id: generateIssueId(),
    title,
    category,
    location,
    description,
    urgency,
    upvotes: 1, // Submitter automatically upvotes
    status: "Received",
    date: currentDate,
    imageUrl: imageUrl || "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?auto=format&fit=crop&w=600&q=80", // default placeholder
    isAnonymous,
    reporterName: isAnonymous ? undefined : (reporterName || "Resident"),
    timelineUpdates: [
      {
        status: "Received",
        date: currentDate,
        comment: "Issue successfully reported via Community Hero platform."
      }
    ]
  };

  issues.unshift(newIssue);
  res.status(201).json(newIssue);
});

app.post("/api/issues/:id/upvote", (req, res) => {
  const { id } = req.params;
  const issue = issues.find(i => i.id === id);
  if (!issue) {
    return res.status(404).json({ error: "Issue not found" });
  }
  issue.upvotes += 1;
  res.json(issue);
});

app.post("/api/issues/:id/status", (req, res) => {
  const { id } = req.params;
  const { status, comment } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Missing status field" });
  }

  const issue = issues.find(i => i.id === id);
  if (!issue) {
    return res.status(404).json({ error: "Issue not found" });
  }

  const currentDate = new Date().toISOString().split('T')[0];
  issue.status = status;
  issue.timelineUpdates.push({
    status,
    date: currentDate,
    comment: comment || `Status updated to ${status}.`
  });

  res.json(issue);
});

// Gemini-powered chat assistant endpoint
app.post("/api/chat", async (req, res) => {
  const { message, history } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const ai = getGeminiClient();
    
    const systemInstruction = `You are "AI Civic Assistant", the helpful AI Citizen Assistant for "Community Hero," a hyperlocal civic platform.
Your job is to support residents in reporting local issues such as potholes, garbage pile-ups, water leakages, broken streetlights, or graffiti.

Be friendly, concise, and professional. To help them file a ticket:
1. Help categorize the issue (Choose exactly from: Pothole, Garbage, Water Leakage, Streetlight, Graffiti, or Other).
2. Clarify the location (Ask for street, intersection, or specific landmark).
3. Determine urgency (Low, Medium, or High).

If they provide enough detail, draft a report.
You MUST output your response as a raw JSON string matching this exact schema (no markdown blocks, just raw JSON, do not wrap in \`\`\`json):
{
  "reply": "Your conversational message guiding or updating the citizen...",
  "isDraftIssue": true/false (true ONLY if you have enough details to auto-draft a clean civic report),
  "draftIssueData": {
    "title": "A brief, descriptive summary of the issue (e.g. Broken Streetlight on 4th Ave)",
    "category": "Pothole" | "Garbage" | "Water Leakage" | "Streetlight" | "Graffiti" | "Other",
    "location": "The location details provided",
    "description": "A concise summary of what was reported based on your conversation",
    "urgency": "Low" | "Medium" | "High"
  }
}

Example chat:
User: "The streetlight outside my house is broken"
Your JSON: { "reply": "I'd be glad to help file a report for that broken streetlight! Could you tell me your street name or approximate location so our utility crews can locate it? Also, how urgent would you say this is (Low, Medium, High)?", "isDraftIssue": false }

Once they provide the location and details, set isDraftIssue to true and pre-fill the form fields. Keep your reply friendly!`;

    // Package conversation history for context
    const conversationPrompt = history && history.length > 0 
      ? `Conversation History:\n${history.map((h: any) => `${h.sender === "user" ? "Citizen" : "Assistant"}: ${h.text}`).join("\n")}\n\nNew Message:\nCitizen: ${message}\n\nFormulate your JSON response based on this context.`
      : `New Message:\nCitizen: ${message}\n\nFormulate your JSON response.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: conversationPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const responseText = response.text || "{}";
    try {
      const parsed = JSON.parse(responseText.trim());
      res.json(parsed);
    } catch (parseErr) {
      console.error("Failed to parse Gemini response as JSON:", responseText);
      res.json({
        reply: "I am having trouble processing that right now, but please let me know what issue you would like to report and where!",
        isDraftIssue: false
      });
    }

  } catch (error: any) {
    console.error("Gemini API error:", error);
    // Graceful fallback for missing key or network issues
    res.json({
      reply: "I'm here to help! To report a civic problem, please describe the issue, specify its location, and note its urgency (Low, Medium, or High). " + 
             (process.env.GEMINI_API_KEY ? "My AI module encountered a temporary glitch, but I can still assist you!" : "(Connect a GEMINI_API_KEY in Secrets for AI-assisted drafting)."),
      isDraftIssue: false
    });
  }
});

// Configure Vite middleware or production build output
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Community Hero] Server running on http://localhost:${PORT}`);
  });
}

startServer();
