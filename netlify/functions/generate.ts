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
      image_generation_prompt: {
        type: Type.STRING,
        description:
          'A short, vivid, and picturesque prompt for an image generation model, describing a beautiful, dog-friendly scene at this location. Example: "A golden retriever joyfully running on the sandy shore of a dog-friendly beach on a sunny day."',
      },
    },
    // By making most fields optional, we improve the reliability of the function calling.
    // The system prompt still strongly encourages the model to provide all fields.
    required: ['name', 'description', 'lat', 'lng', 'image_generation_prompt'],
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
- For each 'location', you **MUST** provide a creative 'image_generation_prompt'.
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
    const { prompt } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        status: 400,
        headers: headers,
      });
    }
    
    // Initialize the Google AI client with the API key from environment variables
    // This is the secure way to handle API keys on the server.
    const ai = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
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
    
    // Check if there are any function calls to process
    if (functionCalls.length > 0) {
      const processedCalls = await Promise.all(
        functionCalls.map(async (call) => {
          // Only process 'location' calls that should have an image prompt
          if (call.name === 'location' && call.args.image_generation_prompt) {
            try {
              const imageResponse = await ai.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: `${call.args.image_generation_prompt}, dog-friendly, photorealistic, high quality`,
                config: {
                  numberOfImages: 1,
                  outputMimeType: 'image/jpeg',
                  aspectRatio: '16:9',
                },
              });

              if (imageResponse.generatedImages?.length > 0) {
                const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
                // Add the image data to the arguments of the function call
                call.args.imageBase64 = base64ImageBytes;
              }
            } catch (error) {
              console.error(`Image generation failed for ${call.args.name}:`, error);
              // Continue without image data if generation fails
            }
          }
          return call; // Return the call, modified or not
        })
      );

      return new Response(JSON.stringify({ functionCalls: processedCalls }), {
        status: 200,
        headers: headers,
      });
    }

    // Send the (unmodified) function calls back to the client
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

