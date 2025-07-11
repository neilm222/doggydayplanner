/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';

// Function declaration for extracting location data using Google AI.
const locationFunctionDeclaration: FunctionDeclaration = {
  name: 'location',
  parameters: {
    type: Type.OBJECT,
    description: 'Geographic coordinates of a location.',
    properties: {
      name: {
        type: Type.STRING,
        description: 'Name of the location.',
      },
      description: {
        type: Type.STRING,
        description:
          'Description of the location: why is it relevant, details to know.',
      },
      lat: {
        type: Type.STRING,
        description: 'Latitude of the location.',
      },
      lng: {
        type: Type.STRING,
        description: 'Longitude of the location.',
      },
      time: {
        type: Type.STRING,
        description:
          'Time of day to visit this location (e.g., "09:00", "14:30").',
      },
      duration: {
        type: Type.STRING,
        description:
          'Suggested duration of stay at this location (e.g., "1 hour", "45 minutes").',
      },
      sequence: {
        type: Type.NUMBER,
        description: 'Order in the day itinerary (1 = first stop of the day).',
      },
    },
    required: ['name', 'description', 'lat', 'lng', 'time', 'duration', 'sequence'],
  },
};

// Function declaration for extracting route/line data using Google AI.
const lineFunctionDeclaration: FunctionDeclaration = {
  name: 'line',
  parameters: {
    type: Type.OBJECT,
    description: 'Connection between a start location and an end location.',
    properties: {
      name: {
        type: Type.STRING,
        description: 'Name of the route or connection',
      },
      start: {
        type: Type.OBJECT,
        description: 'Start location of the route',
        properties: {
          lat: {
            type: Type.STRING,
            description: 'Latitude of the start location.',
          },
          lng: {
            type: Type.STRING,
            description: 'Longitude of the start location.',
          },
        },
      },
      end: {
        type: Type.OBJECT,
        description: 'End location of the route',
        properties: {
          lat: {
            type: Type.STRING,
            description: 'Latitude of the end location.',
          },
          lng: {
            type: Type.STRING,
            description: 'Longitude of the end location.',
          },
        },
      },
      transport: {
        type: Type.STRING,
        description:
          'Mode of transportation between locations (e.g., "walking", "driving", "public transit").',
      },
      travelTime: {
        type: Type.STRING,
        description:
          'Estimated travel time between locations (e.g., "15 minutes", "1 hour").',
      },
    },
    required: ['name', 'start', 'end', 'transport', 'travelTime'],
  },
};

// System instructions provided to the Google AI model guiding its responses.
const systemInstructions = `## System Instructions for a Dog-Friendly Interactive Map Explorer

**Model Persona:** You are an expert on all things dog-friendly, a geographically-aware assistant that helps users discover and plan adventures with their furry companions.
Your primary goal is to answer any location-related query by providing ONLY dog-friendly results, visualized on a map.

**Core Capabilities:**

1. **Geographic Knowledge:** You possess extensive knowledge of dog-friendly:
   * Parks, beaches, and hiking trails
   * Restaurant patios, cafes, and breweries
   * Accommodations and hotels
   * Stores and attractions
   * Travel routes and transportation options suitable for dogs

2. **Operation Mode: Doggy Day Planner** 
   * You are ALWAYS in Doggy Day Planner Mode.
   * Create detailed day itineraries that are 100% dog-friendly.
   * Include a logical sequence of locations to visit (e.g., morning hike, lunch at a dog-friendly patio, afternoon at a dog park).
   * Provide specific times and realistic durations for each stop.
   * Include travel routes with dog-friendly transport methods (e.g., walking, driving).
   * Every location MUST include a 'time', 'duration', and 'sequence' number.
   * Every line connecting locations MUST include 'transport' and 'travelTime'.

**Important Guidelines:**
* **STRICT RULE:** ONLY return results that are verifiably dog-friendly. If you are unsure if a location permits dogs, DO NOT include it. It is better to return fewer, high-confidence results than to suggest a place where a dog might not be welcome.
* For ANY query, always provide geographic data through the 'location' and 'line' functions.
* Never reply with just questions. Always attempt to map the information visually.
* For day plans, create realistic schedules considering a dog's needs (e.g., time for water breaks, not too much strenuous activity in a row).`;

// Netlify function handler
export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Initialize the Google AI client with the API key from environment variables
    // This is the secure way to handle API keys on the server.
    const ai = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });
    
    const finalPrompt = prompt + ' dog friendly day trip';
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: finalPrompt,
      config: {
        systemInstruction: systemInstructions,
        temperature: 1,
        tools: [
          {
            functionDeclarations: [
              locationFunctionDeclaration,
              lineFunctionDeclaration,
            ],
          },
        ],
      },
    });

    const functionCalls = response.functionCalls ?? [];
    
    // Send the function calls back to the client
    return new Response(JSON.stringify({ functionCalls }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in Netlify function:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
