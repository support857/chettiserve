import { GoogleGenAI } from "@google/genai";
import { AnalysisResult } from "../types";

// Helper to clean JSON string returned by LLM if it includes markdown code blocks
const cleanJsonString = (str: string): string => {
  return str.replace(/```json\n?|\n?```/g, "").trim();
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const analyzeUrlWithGemini = async (
  apiKey: string,
  url: string
): Promise<AnalysisResult> => {
  // Use the new GoogleGenAI client as per instructions
  const ai = new GoogleGenAI({ apiKey });

  // Prompt designed to replace the Python logic
  const prompt = `
    I need to verify if the following website is an E-commerce store (selling physical products) or a service/corporate site.
    
    Target Website: ${url}

    Please use Google Search to find information about this specific domain.
    
    Return a strictly valid JSON object (no other text) with the following keys:
    - "type": String. Must be one of: "E-commerce", "Local Business", "Corporate", "Blog", "Dead Link" or "Unknown".
    - "details": String. A short sentence describing what they sell or do (e.g., "Sells leather bags and accessories" or "Dentist clinic in Milan").
  `;

  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          // Search Grounding is essential for this task as we can't scrape from the browser directly due to CORS
          tools: [{ googleSearch: {} }],
          temperature: 0.1, // Low temperature for consistent classification
        },
      });

      const text = response.text || "{}";
      
      // Extract sources required by the Grounding policy
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks
        .map((c: any) => c.web?.uri)
        .filter((uri: string | undefined): uri is string => !!uri);

      let parsed: any = { type: "Error", details: "Could not parse response" };
      
      try {
        parsed = JSON.parse(cleanJsonString(text));
      } catch (e) {
        console.warn("Failed to parse Gemini JSON, falling back to raw text", text);
        parsed = { type: "Unknown", details: text.slice(0, 100) + "..." };
      }

      return {
        url,
        type: parsed.type || "Unknown",
        details: parsed.details || "No details provided",
        sources: sources.slice(0, 3) // Keep top 3 sources
      };

    } catch (error: any) {
      lastError = error;
      // Check for 503 Service Unavailable (Overloaded) or 429 Too Many Requests
      // The error object structure might vary, but usually has code or status
      const statusCode = error.status || error.code || 0;
      const isRetryable = statusCode === 503 || statusCode === 429 || (error.message && error.message.includes('overloaded'));

      if (isRetryable && attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt + 1) * 1000; 
        console.warn(`Gemini API Error ${statusCode}. Retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        await wait(delay);
        continue;
      }
      
      // If we reach here, it's either not retryable or we ran out of retries.
      break;
    }
  }

  console.error("Gemini API Error after retries:", lastError);
  return {
    url,
    type: "API Error",
    details: lastError instanceof Error ? lastError.message : "Unknown error",
    sources: []
  };
};