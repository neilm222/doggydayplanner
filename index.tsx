/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// Declare Leaflet.js library (loaded from CDN in index.html)
declare const L: any;

// --- Map and App State ---
let isMapInitialized = false; // Flag to track if the map loaded successfully
let map; // Holds the Leaflet map instance
let mainTileLayer; // Holds the main tile layer instance for event listening
let points = []; // Array to store geographical points from responses
let markers = []; // Array to store map markers (Leaflet)
let lines = []; // Array to store polylines representing routes/connections (Leaflet)
let popUps = []; // Array to store location info including markers and content
let bounds; // Leaflet LatLngBounds object to fit map around points
let dayPlanItinerary = []; // Array to hold structured items for the day plan timeline

// --- DOM Element References (declared here, assigned in initializeApp) ---
let generateButton: Element | null;
let closeTimelineButton: HTMLButtonElement | null;
let timelineToggle: Element | null;
let mapOverlay: Element | null;
let mapElement: HTMLElement | null;
let mapErrorElement: HTMLElement | null;
let promptInput: HTMLTextAreaElement | null;
let errorMessage: Element | null;
let timelineFooter: Element | null;
let timeline: Element | null;
let exportButton: HTMLButtonElement | null;


// Initializes the Leaflet map instance.
function initMap(mapEl: HTMLElement, mapErrorEl: HTMLElement) {
  bounds = L.latLngBounds([]);

  map = L.map(mapEl, {
    center: [51.505, -0.09], // Default center
    zoom: 13, // Default zoom
    zoomControl: false,
  });

  // Add OpenStreetMap tile layer
  mainTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  isMapInitialized = true;
  if (mapErrorEl) mapErrorEl.classList.add('util-hidden');
  if (mapEl) mapEl.classList.remove('util-hidden');
}

// Functions to control the visibility of the timeline panel.
function showTimeline() {
  document.body.classList.add('timeline-visible');
  // Delay map resize to allow for CSS transition
  if (isMapInitialized && map) {
    setTimeout(() => {
      map.invalidateSize();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, {padding: [50, 50]});
      }
    }, 450); // Corresponds to animation duration
  }
}

function hideTimeline() {
  document.body.classList.remove('timeline-visible');
  // Delay map resize to allow for CSS transition
  if (isMapInitialized && map) {
    setTimeout(() => {
      map.invalidateSize();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, {padding: [50, 50]});
      }
    }, 450); // Corresponds to animation duration
  }
}

// Resets the application state to initial conditions.
function restart() {
  points = [];
  dayPlanItinerary = [];
  if (timelineToggle) timelineToggle.classList.add('util-hidden');
  if (timelineFooter) timelineFooter.classList.add('util-hidden');

  if (isMapInitialized) {
    bounds = L.latLngBounds([]);
    markers.forEach((marker) => marker.remove());
    lines.forEach((line) => line.remove());
  }
  markers = [];
  lines = [];
  popUps = [];

  if (timeline) timeline.innerHTML = '';
  if (document.body.classList.contains('timeline-visible')) {
    hideTimeline();
  }
}

// Sends the user's prompt to our secure Netlify function.
async function sendText(prompt: string) {
  const buttonEl = generateButton as HTMLButtonElement;

  if (errorMessage) errorMessage.innerHTML = '';
  restart();

  try {
    // Use a relative URL for the Netlify function for better portability.
    const response = await fetch('/.netlify/functions/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: prompt }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'The server returned an error.');
    }
    
    const data = await response.json();
    const functionCalls = data.functionCalls || [];

    if (functionCalls.length === 0) {
      throw new Error(
        'Could not generate any results. Try again, or try a different prompt.',
      );
    }
    
    // Process the results from the backend
    for (const fn of functionCalls) {
      if (fn.name === 'location') {
        await setPin(fn.args);
      }
      if (fn.name === 'line') {
        await setLeg(fn.args);
      }
    }
    
    if (dayPlanItinerary.length > 0) {
      dayPlanItinerary.sort(
        (a, b) =>
          (a.sequence || Infinity) - (b.sequence || Infinity) ||
          (a.time || '').localeCompare(b.time || ''),
      );
      createTimeline();
      showTimeline();
      if (timelineToggle) {
        timelineToggle.classList.remove('util-hidden');
      }
      if (timelineFooter) {
        timelineFooter.classList.remove('util-hidden');
      }
    }
    if(isMapInitialized && bounds.isValid()){
      map.fitBounds(bounds, {padding: [50, 50]});
    }

  } catch (e) {
    if (errorMessage) errorMessage.innerHTML = "Failed to connect to the planning service. Ensure the Netlify URL is correct in the code. " + e.message;
    console.error('Error sending prompt:', e);
  } finally {
    if (buttonEl) buttonEl.classList.remove('loading');
  }
}

// Processes location data and adds pins/popups to the map if available.
async function setPin(args) {
  const point = {lat: Number(args.lat), lng: Number(args.lng)};
  points.push(point);

  let popupContent = `<b>${args.name}</b><br/>${args.description}`;
  if (args.time) {
    popupContent += `<div style="margin-top: 4px; font-size: 12px; color: #2196F3;">
                  <i class="fas fa-clock"></i> ${args.time}
                  ${args.duration ? ` • ${args.duration}` : ''}
                </div>`;
  }

  const locationInfo: any = {
    name: args.name,
    description: args.description,
    position: point,
    time: args.time,
    duration: args.duration,
    sequence: args.sequence,
    popupContent: popupContent,
  };

  if (isMapInitialized) {
    bounds.extend(point);
    const marker = L.marker(point, {title: args.name}).addTo(map);
    marker.bindPopup(popupContent);
    markers.push(marker);
    locationInfo.marker = marker;
    map.panTo(point);
  }

  popUps.push(locationInfo);
  // Planner mode is always on, so add to itinerary if time is provided.
  if (args.time) {
    dayPlanItinerary.push(locationInfo);
  }
}

// Processes route data and adds lines to the map if available.
async function setLeg(args) {
  const start = {lat: Number(args.start.lat), lng: Number(args.start.lng)};
  const end = {lat: Number(args.end.lat), lng: Number(args.end.lng)};
  points.push(start, end);

  if (isMapInitialized) {
    bounds.extend(start);
    bounds.extend(end);
    
    const path = [start, end];
    const polyline = L.polyline(path, {
        color: '#2196F3',
        weight: 4,
        opacity: 1.0,
        dashArray: '5, 10'
    }).addTo(map);

    // Add custom properties from the AI response to the polyline object.
    // This allows us to retrieve this information later for the timeline.
    polyline.name = args.name;
    polyline.transport = args.transport;
    polyline.travelTime = args.travelTime;
    // Add start/end points for robust lookup later
    polyline.startPoint = start;
    polyline.endPoint = end;

    lines.push(polyline);
  } else {
    // If map isn't initialized, we can still create an object with the
    // line data for the timeline and export functionality.
    lines.push({
      name: args.name,
      transport: args.transport,
      travelTime: args.travelTime,
      startPoint: start,
      endPoint: end,
      remove: () => {}, // Mock remove for consistency in restart()
    });
  }
}

// Creates and populates the timeline view for the day plan.
function createTimeline() {
  if (!timeline || dayPlanItinerary.length === 0) return;
  timeline.innerHTML = '';
  dayPlanItinerary.forEach((item, index) => {
    const timelineItem = document.createElement('div');
    timelineItem.className = 'timeline-item';
    const timeDisplay = item.time || 'Flexible';
    timelineItem.innerHTML = `
      <div class="timeline-time">${timeDisplay}</div>
      <div class="timeline-connector">
        <div class="timeline-dot"></div>
        <div class="timeline-line"></div>
      </div>
      <div class="timeline-content" data-index="${index}">
        <div class="timeline-title">${item.name}</div>
        <div class="timeline-description">${item.description}</div>
        ${item.duration ? `<div class="timeline-duration">${item.duration}</div>` : ''}
      </div>
    `;
    const timelineContent = timelineItem.querySelector('.timeline-content');
    if (timelineContent) {
      timelineContent.addEventListener('click', () => {
        const popupIndex = popUps.findIndex((p) => p.name === item.name);
        if (popupIndex !== -1) {
          highlightTimelineItem(popupIndex);
          if (isMapInitialized) {
            popUps.forEach((location, i) => {
              if (location.marker) {
                if (i === popupIndex) {
                  location.marker.openPopup();
                } else {
                  location.marker.closePopup();
                }
              }
            });
            map.panTo(popUps[popupIndex].position);
          }
        }
      });
    }
    timeline.appendChild(timelineItem);
  });
  if (lines.length > 0) {
    const timelineItems = timeline.querySelectorAll('.timeline-item');
    for (let i = 0; i < timelineItems.length - 1; i++) {
      const currentItem = dayPlanItinerary[i];
      const nextItem = dayPlanItinerary[i + 1];
      const connectingLine = lines.find(
        (line:any) => {
            if (!line.startPoint || !line.endPoint) return false;
            const p1 = currentItem.position;
            const p2 = nextItem.position;
            const l_start = line.startPoint;
            const l_end = line.endPoint;
            // Check for match in either direction
            return (l_start.lat === p1.lat && l_start.lng === p1.lng && l_end.lat === p2.lat && l_end.lng === p2.lng) ||
                   (l_start.lat === p2.lat && l_start.lng === p2.lng && l_end.lat === p1.lat && l_end.lng === p1.lng);
        }
      );
      if (connectingLine && (connectingLine.transport || connectingLine.travelTime)) {
        const transportItem = document.createElement('div');
        transportItem.className = 'timeline-item transport-item';
        // Use emoji for transport icon for better PDF compatibility
        const transportIcon = getTransportIcon(connectingLine.transport || 'travel');
        transportItem.innerHTML = `
          <div class="timeline-time"></div>
          <div class="timeline-connector">
            <div class="timeline-dot" style="background-color: #999;"></div>
            <div class="timeline-line"></div>
          </div>
          <div class="timeline-content transport">
            <div class="timeline-title">
              ${transportIcon}
              ${connectingLine.transport || 'Travel'}
            </div>
            <div class="timeline-description">${connectingLine.name}</div>
            ${connectingLine.travelTime ? `<div class="timeline-duration">${connectingLine.travelTime}</div>` : ''}
          </div>
        `;
        timelineItems[i].after(transportItem);
      }
    }
  }
}

// Returns an appropriate Font Awesome icon class or emoji based on transport type.
function getTransportIcon(transportType: string): string {
  const type = (transportType || '').toLowerCase();
    
  // Return Font Awesome class
  if (type.includes('walk')) return `<i class="fas fa-walking"></i>`;
  if (type.includes('car') || type.includes('driv')) return `<i class="fas fa-car-side"></i>`;
  if (type.includes('bus') || type.includes('transit') || type.includes('public')) return `<i class="fas fa-bus-alt"></i>`;
  if (type.includes('train') || type.includes('subway') || type.includes('metro')) return `<i class="fas fa-train"></i>`;
  if (type.includes('bike') || type.includes('cycl')) return `<i class="fas fa-bicycle"></i>`;
  if (type.includes('taxi') || type.includes('cab')) return `<i class="fas fa-taxi"></i>`;
  if (type.includes('boat') || type.includes('ferry')) return `<i class="fas fa-ship"></i>`;
  if (type.includes('plane') || type.includes('fly')) return `<i class="fas fa-plane-departure"></i>`;
  return `<i class="fas fa-route"></i>`; // Default icon
}

// Highlights the timeline item corresponding to the selected card.
function highlightTimelineItem(cardIndex: number) {
  if (!timeline) return;
  const timelineItems = timeline.querySelectorAll('.timeline-content:not(.transport)');
  timelineItems.forEach((item) => item.classList.remove('active'));

  const location = popUps[cardIndex];
  for (const item of timelineItems) {
    const title = item.querySelector('.timeline-title');
    if (title && title.textContent === location.name) {
      item.classList.add('active');
      item.scrollIntoView({behavior: 'smooth', block: 'nearest'});
      break;
    }
  }
}

// Manually draws the itinerary on the PDF, handling page breaks.
function drawItineraryOnPdf(doc: jsPDF, fullItinerary: any[]) {
    let y = 40; // Initial y position
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const timeX = margin;
    const connectorX = timeX + 45;
    const contentX = connectorX + 15;
    const contentWidth = doc.internal.pageSize.getWidth() - contentX - margin;

    doc.setFont('helvetica');
    doc.setFontSize(22);
    doc.text("Your Doggy Day Plan", margin, y);
    y += 25; // Increased spacing

    const checkPageBreak = (neededHeight) => {
        if (y + neededHeight > pageHeight - margin) {
            doc.addPage();
            y = margin;
        }
    };

    fullItinerary.forEach((item, index) => {
        // Estimate height for block to check for page break
        let blockHeight = 40; // Increased min height for more spacing
        const textToMeasure = item.type === 'location' ? item.data.description : item.data.name;
        blockHeight += doc.getTextDimensions(doc.splitTextToSize(textToMeasure || '', contentWidth)).h;
        checkPageBreak(blockHeight);

        const itemStartY = y;

        if (item.type === 'location') {
            const data = item.data;
            // Draw time and location dot
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text(data.time || '', timeX, y);
            doc.setFillColor(33, 150, 243); // blue
            doc.circle(connectorX, y - 1, 3, 'F');

            // Draw content
            doc.setFontSize(14);
            doc.text(data.name, contentX, y);
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            const descriptionLines = doc.splitTextToSize(data.description || '', contentWidth);
            doc.text(descriptionLines, contentX, y + 14);
            const descHeight = doc.getTextDimensions(descriptionLines).h;
            
            let durationY = y + 14 + descHeight + 6; // Increased spacing
            if(data.duration) {
                doc.setFontSize(9);
                doc.setTextColor(33, 150, 243);
                doc.text(data.duration, contentX, durationY);
                doc.setTextColor(0,0,0);
            }
            y = durationY + 20; // Increased spacing

        } else if (item.type === 'transport') {
            const data = item.data;
            // Draw transport dot
            doc.setFillColor(153, 153, 153); // grey
            doc.circle(connectorX, y - 1, 3, 'F');

            // Draw content
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            const transportText = (data.transport || 'Travel').charAt(0).toUpperCase() + (data.transport || 'Travel').slice(1);
            doc.text(transportText, contentX, y);
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(data.name || '', contentX, y + 14); // Increased spacing
            
            let travelTimeY = y + 14 + 12; // Increased spacing
            if (data.travelTime) {
                doc.setFontSize(9);
                doc.setTextColor(33, 150, 243);
                doc.text(data.travelTime, contentX, travelTimeY);
                doc.setTextColor(0,0,0);
            }
            y = travelTimeY + 20; // Increased spacing
        }

        // Draw Connector Line
        if (index < fullItinerary.length - 1) {
            doc.setDrawColor(224, 224, 224); // light grey
            doc.setLineWidth(0.5);
            doc.line(connectorX, itemStartY + 4, connectorX, y - 12);
        }
    });
}


// Helper function to introduce a delay.
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Exports the day plan timeline to a PDF document.
async function exportDayPlan() {
    if (!exportButton) return;
    const buttonOriginalText = exportButton.innerHTML;
    exportButton.disabled = true;
    exportButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
    
    // Temporarily hide polylines for a cleaner map image
    lines.forEach(line => line.setStyle({ opacity: 0 }));

    try {
        const mapEl = document.getElementById('map');
        if (!mapEl) throw new Error('Map element not found');
        
        // Force map redraw and wait for layers to render before capture.
        if (map) map.invalidateSize();
        await delay(300);

        // 1. Capture Map
        const mapCanvas = await html2canvas(mapEl, { useCORS: true });
        const mapImgData = mapCanvas.toDataURL('image/png');

        // 2. Create PDF
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
        
        // 3. Add Map to first page
        pdf.addImage(mapImgData, 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), 0);

        // 4. Create full itinerary data by merging locations and travel legs
        const fullItinerary = [];
        dayPlanItinerary.forEach((item, index) => {
            fullItinerary.push({ type: 'location', data: item });
            if (index < dayPlanItinerary.length - 1) {
                const nextItem = dayPlanItinerary[index + 1];
                const connectingLine = lines.find((line: any) => {
                    if (!line.startPoint || !line.endPoint) return false;
                    const p1 = item.position;
                    const p2 = nextItem.position;
                    const l_start = line.startPoint;
                    const l_end = line.endPoint;
                    return (l_start.lat === p1.lat && l_start.lng === p1.lng && l_end.lat === p2.lat && l_end.lng === p2.lng) ||
                           (l_start.lat === p2.lat && l_start.lng === p2.lng && l_end.lat === p1.lat && l_end.lng === p1.lng);
                });
                if (connectingLine) {
                    fullItinerary.push({ type: 'transport', data: connectingLine });
                }
            }
        });

        // 5. Add new page and draw itinerary
        if (fullItinerary.length > 0) {
            pdf.addPage();
            drawItineraryOnPdf(pdf, fullItinerary);
        }

        // 6. Save PDF
        pdf.save('doggy-day-plan.pdf');

    } catch (error) {
        console.error('Failed to export PDF:', error);
        if(errorMessage) errorMessage.textContent = 'Could not generate PDF. An error occurred.';
    } finally {
        // Ensure polylines are always made visible again
        lines.forEach(line => line.setStyle({ opacity: 1.0 }));
        exportButton.disabled = false;
        exportButton.innerHTML = buttonOriginalText;
    }
}


// Unified handler for submitting the prompt from either button click or Enter key.
function handlePromptSubmission() {
  if (!promptInput || !promptInput.value.trim()) return; // Do not submit empty prompts
  const prompt = promptInput.value;

  const buttonEl = generateButton as HTMLButtonElement;
  buttonEl.classList.add('loading');

  // Clear and reset textarea UI immediately for better perceived performance
  promptInput.value = '';
  promptInput.style.height = '36px'; // Reset height to default

  // Use a small timeout to allow the UI to update before starting the network request
  setTimeout(() => {
    sendText(prompt);
  }, 10);
}

// Main app initialization function
function initializeApp() {
  // --- Assign DOM Elements ---
  // This is done here to ensure the DOM is fully loaded before we try to find elements.
  generateButton = document.querySelector('#generate');
  closeTimelineButton = document.querySelector('#close-timeline') as HTMLButtonElement;
  timelineToggle = document.querySelector('#timeline-toggle');
  mapOverlay = document.querySelector('#map-overlay');
  mapElement = document.getElementById('map');
  mapErrorElement = document.getElementById('map-error');
  promptInput = document.querySelector('#prompt-input') as HTMLTextAreaElement;
  errorMessage = document.querySelector('#error-message');
  timelineFooter = document.querySelector('#timeline-footer');
  timeline = document.querySelector('#timeline');
  exportButton = document.querySelector('#export-button') as HTMLButtonElement;
  
  // --- Initial Setup ---
  if(promptInput) {
    promptInput.placeholder = "Plan a dog-friendly day in... (e.g. 'Austin, TX')";
  }

  // --- Event Listeners ---
  if (promptInput) {
    // Add auto-resizing logic to the prompt textarea
    promptInput.addEventListener('input', () => {
      promptInput.style.height = 'auto'; // Reset height to recalculate
      promptInput.style.height = `${promptInput.scrollHeight}px`; // Set to content height
    });
    
    // Add listener for Enter key submission
    promptInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent default Enter behavior (new line)
        handlePromptSubmission();
      }
    });
  }

  if (generateButton) {
    generateButton.addEventListener('click', () => {
      handlePromptSubmission();
    });
  }
  
  if (exportButton) {
    exportButton.addEventListener('click', exportDayPlan);
  }

  if (closeTimelineButton) {
    closeTimelineButton.addEventListener('click', () => hideTimeline());
  }
  if (timelineToggle) {
    timelineToggle.addEventListener('click', () => showTimeline());
  }
  if (mapOverlay) {
    mapOverlay.addEventListener('click', () => hideTimeline());
  }

  // --- Map Initialization ---
  try {
    if (typeof L === 'undefined') {
      throw new Error("Leaflet.js (variable L) is not defined. The script may have failed to load from the CDN.");
    }
    if (mapElement && mapErrorElement) {
        initMap(mapElement, mapErrorElement);
    } else {
        throw new Error("Map container elements (#map or #map-error) were not found in the DOM.");
    }
  } catch (error) {
    console.error(`CRITICAL MAP FAILURE: ${error.message}`);
    if (mapErrorElement) mapErrorElement.classList.remove('util-hidden');
    if (mapElement) mapElement.classList.add('util-hidden');
    isMapInitialized = false;
  }
}

// Start the application once the DOM is fully loaded.
// This is a more robust way to prevent race conditions where the script
// tries to access DOM elements that haven't been created yet.
document.addEventListener('DOMContentLoaded', initializeApp);