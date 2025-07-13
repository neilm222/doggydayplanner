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
    // By making most fields optional, we improve the reliability of the function calling.
    // The system prompt still strongly encourages the model to provide all fields.
    required: ['name', 'description', 'lat', 'lng'],
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
    // The frontend can handle missing optional fields, so this improves reliability.
    required: ['start', 'end'],
  },
};

// System instructions provided to the Google AI model guiding its responses.
const systemInstructions = `You are a helpful assistant that creates dog-friendly day trip itineraries.
- Your primary goal is to respond to user queries by creating a detailed, dog-friendly day plan.
- **STRICT RULE**: Only include locations that are verifiably dog-friendly. If unsure, do not include them.
- You **MUST** use the 'location' and 'line' functions to structure your response.
- For the best user experience, you should ideally include a logical sequence, times, durations, and travel details for the itinerary.`;

// Netlify function handler
export default async (req: Request) => {
  // CORS headers to allow requests from any origin. This is necessary because the
  // frontend is on gizmopup.com and the backend is on netlify.app.
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight CORS request sent by browsers.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: headers,
    });
  }

  try {
    // Add a check for the API key at the beginning. This provides a clear
    // error message if the environment variable is not set.
    if (!process.env.API_KEY) {
      throw new Error('The API_KEY environment variable is not set in the Netlify configuration.');
    }
    
    const { prompt } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        status: 400,
        headers: headers,
      });
    }
    
    // Initialize the Google AI client with the API key from environment variables
    const ai = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: prompt }] },
      config: {
        systemInstruction: systemInstructions,
        temperature: 1,
        // Disable thinking to speed up the response and avoid serverless timeouts.
        thinkingConfig: { thinkingBudget: 0 },
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
    
    // The Gemini API returns function calls within the 'parts' of the first candidate's content.
    // This is the robust way to extract them.
    const functionCalls = response.candidates?.[0]?.content?.parts
      // Filter out any parts that are not function calls.
      .filter(part => !!part.functionCall)
      // Map the array to contain just the functionCall object.
      .map(part => part.functionCall) 
      // If there are no function calls, default to an empty array.
      ?? [];
    
    // Send the function calls back to the client
    return new Response(JSON.stringify({ functionCalls }), {
      status: 200,
      headers: headers,
    });

  } catch (error) {
    console.error('Error in Netlify function:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500,
      headers: headers,
    });
  }
};
