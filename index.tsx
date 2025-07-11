/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {jsPDF} from 'jspdf';
import html2canvas from 'html2canvas';

// Declare Leaflet.js library (loaded from CDN in index.html)
declare const L: any;

// --- Map and App State ---
// These will be populated by the initialization function.
let isMapInitialized = false; // Flag to track if the map loaded successfully
let map; // Holds the Leaflet map instance
let mainTileLayer; // Holds the main tile layer instance for event listening
let points = []; // Array to store geographical points from responses
let markers = []; // Array to store map markers (Leaflet)
let lines = []; // Array to store polylines representing routes/connections (Leaflet)
let popUps = []; // Array to store location info including markers and content
let bounds; // Leaflet LatLngBounds object to fit map around points
let activeCardIndex = 0; // Index of the currently selected location card
let dayPlanItinerary = []; // Array to hold structured items for the day plan timeline

// Initializes the Leaflet map instance.
function initMap(mapElement: HTMLElement, mapErrorElement: HTMLElement) {
  bounds = L.latLngBounds([]);

  map = L.map(mapElement, {
    center: [51.505, -0.09], // Default center
    zoom: 13, // Default zoom
    zoomControl: false,
    preferCanvas: true, // For better PDF export compatibility
  });

  // Add OpenStreetMap tile layer
  mainTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  isMapInitialized = true;
  if (mapErrorElement) mapErrorElement.classList.add('util-hidden');
  if (mapElement) mapElement.classList.remove('util-hidden');
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
  const timelineToggle = document.querySelector('#timeline-toggle');
  const timelineFooter = document.querySelector('#timeline-footer');
  const cardContainer = document.querySelector('#card-container');
  const carouselIndicators = document.querySelector('#carousel-indicators');
  const cardCarousel = document.querySelector('.card-carousel') as HTMLDivElement;
  const timeline = document.querySelector('#timeline');

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

  if (cardContainer) cardContainer.innerHTML = '';
  if (carouselIndicators) carouselIndicators.innerHTML = '';
  if (cardCarousel) cardCarousel.style.display = 'none';
  if (timeline) timeline.innerHTML = '';
  if (document.body.classList.contains('timeline-visible')) {
    hideTimeline();
  }
}

// Sends the user's prompt to our secure Netlify function.
async function sendText(prompt: string) {
  const spinner = document.querySelector('#spinner');
  const errorMessage = document.querySelector('#error-message');
  const buttonEl = document.getElementById('generate') as HTMLButtonElement;

  spinner.classList.remove('util-hidden');
  errorMessage.innerHTML = '';
  restart();

  try {
    // Use the absolute URL for the Netlify function, allowing calls from other domains.
    const response = await fetch('https://comforting-biscotti-21b51e.netlify.app/.netlify/functions/generate', {
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
      const timelineToggle = document.querySelector('#timeline-toggle');
      const timelineFooter = document.querySelector('#timeline-footer');
      if (timelineToggle) {
        timelineToggle.classList.remove('util-hidden');
      }
      if (timelineFooter) {
        timelineFooter.classList.remove('util-hidden');
      }
    }
    createLocationCards();
    if(isMapInitialized && bounds.isValid()){
      map.fitBounds(bounds, {padding: [50, 50]});
    }

  } catch (e) {
    errorMessage.innerHTML = "Failed to connect to the planning service. Ensure the Netlify URL is correct in the code. " + e.message;
    console.error('Error sending prompt:', e);
  } finally {
    buttonEl.classList.remove('loading');
    spinner.classList.add('util-hidden');
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
    popupContent: popupContent
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
  const timeline = document.querySelector('#timeline') as HTMLDivElement;
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
          highlightCard(popupIndex);
          if (isMapInitialized) map.panTo(popUps[popupIndex].position);
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
        const transportIcon = getTransportIcon(connectingLine.transport || 'travel', true);
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
function getTransportIcon(transportType: string, useEmoji = false): string {
  const type = (transportType || '').toLowerCase();
  
  if (useEmoji) {
    if (type.includes('walk')) return '🚶';
    if (type.includes('car') || type.includes('driv')) return '🚗';
    if (type.includes('bus') || type.includes('transit') || type.includes('public')) return '🚌';
    if (type.includes('train') || type.includes('subway') || type.includes('metro')) return '🚆';
    if (type.includes('bike') || type.includes('cycl')) return '🚲';
    if (type.includes('taxi') || type.includes('cab')) return '🚕';
    if (type.includes('boat') || type.includes('ferry')) return '🚢';
    if (type.includes('plane') || type.includes('fly')) return '✈️';
    return '➡️'; // Default emoji
  }
  
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


// Generates a placeholder SVG image for location cards.
function getPlaceholderImage(locationName: string): string {
  let hash = 0;
  for (let i = 0; i < locationName.length; i++) {
    hash = locationName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  const saturation = 60 + (hash % 30);
  const lightness = 50 + (hash % 20);
  const letter = locationName.charAt(0).toUpperCase() || '?';
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
      <rect width="300" height="180" fill="hsl(${hue}, ${saturation}%, ${lightness}%)" />
      <text x="150" y="95" font-family="Arial, sans-serif" font-size="72" fill="white" text-anchor="middle" dominant-baseline="middle">${letter}</text>
    </svg>
  `)}`;
}

// Creates and displays location cards in the carousel.
function createLocationCards() {
  const cardContainer = document.querySelector('#card-container') as HTMLDivElement;
  const carouselIndicators = document.querySelector('#carousel-indicators') as HTMLDivElement;
  const cardCarousel = document.querySelector('.card-carousel') as HTMLDivElement;
  
  if (!cardContainer || !carouselIndicators || popUps.length === 0) return;
  cardContainer.innerHTML = '';
  carouselIndicators.innerHTML = '';
  cardCarousel.style.display = 'block';

  popUps.forEach((location, index) => {
    const card = document.createElement('div');
    card.className = 'location-card';
    card.classList.add('day-planner-card'); // Always add planner styles
    if (index === 0) card.classList.add('card-active');

    const imageUrl = getPlaceholderImage(location.name);
    let cardContent = `<div class="card-image" style="background-image: url('${imageUrl}')"></div>`;

    if (location.sequence) cardContent += `<div class="card-sequence-badge">${location.sequence}</div>`;
    if (location.time) cardContent += `<div class="card-time-badge">${location.time}</div>`;

    const {lat, lng} = location.position;
    cardContent += `
      <div class="card-content">
        <h3 class="card-title">${location.name}</h3>
        <p class="card-description">${location.description}</p>
        ${location.duration ? `<div class="card-duration">${location.duration}</div>` : ''}
        <div class="card-coordinates">
          ${lat.toFixed(5)}, ${lng.toFixed(5)}
        </div>
      </div>
    `;
    card.innerHTML = cardContent;

    card.addEventListener('click', () => {
      highlightCard(index);
      if (isMapInitialized) map.panTo(location.position);
      if (document.querySelector('#timeline')) highlightTimelineItem(index);
    });

    cardContainer.appendChild(card);

    const dot = document.createElement('div');
    dot.className = 'carousel-dot';
    if (index === 0) dot.classList.add('active');
    carouselIndicators.appendChild(dot);
  });

  if (cardCarousel && popUps.length > 0) {
    cardCarousel.style.display = 'block';
  }
}

// Highlights the selected card and corresponding elements.
function highlightCard(index: number) {
  activeCardIndex = index;
  const cardContainer = document.querySelector('#card-container') as HTMLDivElement;
  const carouselIndicators = document.querySelector('#carousel-indicators') as HTMLDivElement;
  const cards = cardContainer?.querySelectorAll('.location-card');
  if (!cards) return;

  cards.forEach((card) => card.classList.remove('card-active'));
  if (cards[index]) {
    const activeCard = cards[index] as HTMLElement;
    activeCard.classList.add('card-active');
    const cardWidth = activeCard.offsetWidth;
    const containerWidth = cardContainer.offsetWidth;
    const scrollPosition = activeCard.offsetLeft - containerWidth / 2 + cardWidth / 2;
    cardContainer.scrollTo({left: scrollPosition, behavior: 'smooth'});
  }

  const dots = carouselIndicators?.querySelectorAll('.carousel-dot');
  if (dots) {
    dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
  }

  if (isMapInitialized) {
    popUps.forEach((location, i) => {
      if (location.marker) {
        if(i === index) {
            location.marker.openPopup();
        } else {
            location.marker.closePopup();
        }
      }
    });
  }

  highlightTimelineItem(index);
}

// Highlights the timeline item corresponding to the selected card.
function highlightTimelineItem(cardIndex: number) {
  const timeline = document.querySelector('#timeline') as HTMLDivElement;
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

// Allows navigation through cards using arrow buttons.
function navigateCards(direction: number) {
  const newIndex = activeCardIndex + direction;
  if (newIndex >= 0 && newIndex < popUps.length) {
    highlightCard(newIndex);
    if (isMapInitialized) map.panTo(popUps[newIndex].position);
  }
}

/**
 * Manually draws the itinerary on a jsPDF document.
 * This provides a robust alternative to the buggy `doc.html()` renderer and avoids
 * using special characters/emojis that can cause garbled text in the PDF.
 * @param {jsPDF} doc - The jsPDF document instance.
 * @param {number} startY - The Y position to start drawing from.
 * @returns {number} The final Y position after drawing.
 */
function drawItineraryOnPdf(doc: jsPDF, startY: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 0.5; // in inches
  const contentWidth = doc.internal.pageSize.getWidth() - margin * 2;
  let y = startY;

  // Helper to check for page breaks
  const checkPageBreak = (neededHeight) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Itinerary Header
  checkPageBreak(0.5);
  doc.setFontSize(18).setFont(undefined, 'bold');
  doc.text('Itinerary Details', margin, y);
  y += 0.3;

  // Build a combined list of locations and travel legs
  const fullItinerary = [];
  dayPlanItinerary.forEach((item, index) => {
    fullItinerary.push({ type: 'location', data: item });
    if (index < dayPlanItinerary.length - 1) {
      const nextItem = dayPlanItinerary[index + 1];
      const connectingLine = lines.find(
        (line: any) => {
            if (!line.startPoint || !line.endPoint) return false;
            const p1 = item.position;
            const p2 = nextItem.position;
            const l_start = line.startPoint;
            const l_end = line.endPoint;
            // Check for match in either direction
            return (l_start.lat === p1.lat && l_start.lng === p1.lng && l_end.lat === p2.lat && l_end.lng === p2.lng) ||
                   (l_start.lat === p2.lat && l_start.lng === p2.lng && l_end.lat === p1.lat && l_end.lng === p1.lng);
        }
      ) as any;
      if (connectingLine) {
        fullItinerary.push({ type: 'travel', data: connectingLine, to: nextItem.name });
      }
    }
  });

  // Loop and draw each item
  for (const item of fullItinerary) {
    if (item.type === 'location') {
      const { name, sequence, time, duration, description } = item.data;
      const descLines = doc.splitTextToSize(description || '', contentWidth - 0.5);
      const itemHeight = 0.6 + (descLines.length * 0.2); // Estimate height
      checkPageBreak(itemHeight);

      // Sequence Circle and Title
      doc.setFillColor(33, 150, 243); // #2196F3
      doc.circle(margin + 0.15, y + 0.1, 0.12, 'F');
      doc.setTextColor(255, 255, 255).setFontSize(10).setFont(undefined, 'bold');
      doc.text(String(sequence), margin + 0.15, y + 0.13, { align: 'center' });

      doc.setTextColor(26, 115, 232).setFontSize(16).setFont(undefined, 'bold');
      doc.text(name, margin + 0.4, y + 0.15);
      y += 0.35;

      // Time and Duration (plain text to prevent garbling)
      doc.setTextColor(80, 80, 80).setFontSize(10).setFont(undefined, 'normal');
      let detailsText = `Time: ${time || 'Flexible'}`;
      if (duration) detailsText += `  |  Duration: ${duration}`;
      doc.text(detailsText, margin, y);
      y += 0.25;
      
      // Description
      doc.setDrawColor(224, 224, 224); // Light grey
      doc.setLineWidth(0.01);
      doc.line(margin + 0.05, y - 0.05, margin + 0.05, y + (descLines.length * 0.18));
      doc.setTextColor(102, 102, 102).setFontSize(10);
      doc.text(descLines, margin + 0.2, y);
      y += descLines.length * 0.18 + 0.1;

    } else if (item.type === 'travel') {
      const { transport, travelTime } = item.data;
      const to = item.to;
      checkPageBreak(0.5);

      // Vertical line connector
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.01);
      doc.line(margin + 0.15, y, margin + 0.15, y + 0.4);
      
      // Transport details (plain text to prevent garbling)
      let travelText = `${transport || 'Travel'} to ${to}`;
      if (travelTime) travelText += ` (${travelTime})`;

      doc.setFillColor(240, 240, 240); // Light grey background
      doc.setDrawColor(221, 221, 221);
      const textWidth = doc.getStringUnitWidth(travelText) * 10 / doc.internal.scaleFactor; // Get text width
      doc.roundedRect(margin + 0.5, y, textWidth + 0.3, 0.25, 0.1, 0.1, 'FD');

      doc.setTextColor(68, 68, 68).setFontSize(9).setFont(undefined, 'normal');
      doc.text(travelText, margin + 0.65, y + 0.16);
      y += 0.5;
    }
  }
  return y;
}

// Exports the current day plan as a letter-sized PDF with the map.
async function exportDayPlan() {
  if (!dayPlanItinerary.length) {
    alert('There is no day plan to export.');
    return;
  }

  const exportButton = document.querySelector('#export-plan') as HTMLButtonElement;
  const originalButtonHTML = exportButton.innerHTML;
  exportButton.disabled = true;
  exportButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating...`;
  
  // --- UI Preparation for Capture ---
  const leafletControls = document.querySelector('.leaflet-control-container') as HTMLElement;
  const cardCarouselEl = document.querySelector('.card-carousel') as HTMLElement;
  
  const wasTimelineVisible = document.body.classList.contains('timeline-visible');
  const originalControlsDisplay = leafletControls ? leafletControls.style.display : '';
  const originalCarouselDisplay = cardCarouselEl ? cardCarouselEl.style.display : '';

  // Hide UI elements that might interfere with the map capture
  if (leafletControls) leafletControls.style.display = 'none';
  if (cardCarouselEl) cardCarouselEl.style.display = 'none';
  // If timeline is visible, hide it and wait for the animation to complete,
  // as this also triggers a map resize which is crucial.
  if (wasTimelineVisible) {
    hideTimeline();
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for animation
  }

  try {
    // Wait for map to be fully loaded and settled before taking a screenshot
    if (isMapInitialized && bounds?.isValid() && mainTileLayer) {
      const mapReadyPromise = new Promise<void>(resolve => {
          let timeoutId = null;
          
          const onTilesLoaded = () => {
              if (timeoutId) clearTimeout(timeoutId);
              mainTileLayer.off('load', onTilesLoaded);
              // Short delay for final browser paint after tiles are loaded
              setTimeout(resolve, 500);
          };

          mainTileLayer.on('load', onTilesLoaded);
          map.fitBounds(bounds, { padding: [40, 40] });

          // Fallback timeout in case 'load' event doesn't fire (e.g., all tiles cached)
          timeoutId = setTimeout(() => {
              mainTileLayer.off('load', onTilesLoaded); // Clean up listener
              resolve();
          }, 3000);
      });
      await mapReadyPromise;
    }

    const mapElement = document.getElementById('map');
    const mapCanvas = await html2canvas(mapElement, { 
      useCORS: true,
      logging: false,
    });
    const mapImgData = mapCanvas.toDataURL('image/png', 1.0);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 0.5;
    const contentWidth = pageWidth - margin * 2;
    
    doc.setFontSize(24).setFont(undefined, 'bold');
    doc.text('Your Doggy Day Plan', margin, margin + 0.3);

    const mapAspectRatio = mapCanvas.height / mapCanvas.width;
    const mapImgHeight = contentWidth * mapAspectRatio;
    doc.addImage(mapImgData, 'PNG', margin, margin + 0.5, contentWidth, mapImgHeight);
    
    let yPos = margin + 0.5 + mapImgHeight + 0.3;
    
    if (yPos > doc.internal.pageSize.getHeight() - 3) {
      doc.addPage();
      yPos = margin;
    }

    drawItineraryOnPdf(doc, yPos);
    
    doc.save('doggy-day-plan.pdf');

  } catch (error) {
    console.error('Failed to export PDF:', error);
    alert('An error occurred while generating the PDF. Please try again.');
  } finally {
    // --- Restore UI ---
    if (leafletControls) leafletControls.style.display = originalControlsDisplay;
    if (cardCarouselEl) cardCarouselEl.style.display = originalCarouselDisplay;
    if (wasTimelineVisible) showTimeline();
    
    exportButton.disabled = false;
    exportButton.innerHTML = originalButtonHTML;
  }
}

// Wait until the DOM is fully loaded before running any script that interacts with it.
document.addEventListener('DOMContentLoaded', () => {

  // DOM Element references
  const generateButton = document.querySelector('#generate');
  const prevCardButton = document.querySelector('#prev-card') as HTMLButtonElement;
  const nextCardButton = document.querySelector('#next-card') as HTMLButtonElement;
  const closeTimelineButton = document.querySelector('#close-timeline') as HTMLButtonElement;
  const timelineToggle = document.querySelector('#timeline-toggle');
  const mapOverlay = document.querySelector('#map-overlay');
  const exportPlanButton = document.querySelector('#export-plan') as HTMLButtonElement;
  const mapElement = document.getElementById('map');
  const mapErrorElement = document.getElementById('map-error');
  const promptInput = document.querySelector('#prompt-input') as HTMLTextAreaElement;

  // Set initial placeholder, as Planner Mode is always on.
  promptInput.placeholder = "Plan a dog-friendly day in... (e.g. 'Austin, TX')";

  // Unified handler for submitting the prompt from either button click or Enter key.
  function handlePromptSubmission() {
    const prompt = promptInput.value;
    if (!prompt.trim()) return; // Do not submit empty prompts

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

  // Event Listeners for UI elements.
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

  if (prevCardButton) {
    prevCardButton.addEventListener('click', () => navigateCards(-1));
  }
  if (nextCardButton) {
    nextCardButton.addEventListener('click', () => navigateCards(1));
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
  if (exportPlanButton) {
    exportPlanButton.addEventListener('click', () => exportDayPlan());
  }

  // Main app initialization function
  function initializeApp() {
    try {
      // Check if Leaflet is loaded
      if (typeof L === 'undefined') {
        throw new Error("Leaflet.js failed to load.");
      }
      initMap(mapElement, mapErrorElement);
    } catch (error) {
      console.error("Map failed to load. The app will run without map features.", error);
      if (mapErrorElement) mapErrorElement.classList.remove('util-hidden');
      if (mapElement) mapElement.classList.add('util-hidden');
      isMapInitialized = false;
    }
  }

  // Start the application
  initializeApp();
});

