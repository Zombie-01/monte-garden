import './style.css';
import { initRooms } from './rooms.js';

initRooms({
  stage: document.getElementById('roomsStage'),
  viewport: document.getElementById('roomsViewport'),
  plan: document.getElementById('roomsPlan'),
  img: document.getElementById('roomsImg'),
  list: document.getElementById('roomsList'),
  filters: document.getElementById('roomsFilters'),
  legend: document.getElementById('roomsLegend'),
  hotspotLayer: document.getElementById('roomsSpots'),
  info: { title: document.getElementById('roomsTitle'), total: document.getElementById('roomsTotal'), count: document.getElementById('roomsCount') },
});
