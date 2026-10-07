/* ==========================================================
   RollCall — Student Organization Event & Attendance Manager
   Plain JavaScript, no libraries, no backend. Data lives in localStorage.

   Every business rule is enforced inside the data functions
   (createEvent, registerStudent, checkInStudent, ...), not only by
   hiding buttons, so the rules hold no matter how an action is triggered.
   ========================================================== */
'use strict';

/* ---------- Constants ---------- */

// Bump the version suffix to start every browser fresh with no data.
const STORAGE_KEYS = {
  events: 'rollcall.v3.events',
  registrations: 'rollcall.v3.registrations',
};
const LEGACY_STORAGE_KEYS = [
  'rollcall.events', 'rollcall.registrations',
  'rollcall.v2.events', 'rollcall.v2.registrations',
];

// Rule 1: the only allowed status order.
const STATUS_FLOW = ['Draft', 'Open', 'Closed', 'Completed'];

const STATUS_LABELS = {
  Draft: 'Draft',
  Open: 'Open for Registration',
  Closed: 'Closed',
  Completed: 'Completed',
};

const STUDENT_ID_PATTERN = /^[A-Z0-9-]{3,20}$/;
const TOAST_DURATION_MS = 4000;

/* ---------- App state ---------- */

const state = {
  events: [],
  registrations: [],
  statusFilter: 'All',   // status chip selected on the events list
  selectedEventId: null, // event shown in the details view
  editingEventId: null,  // event being edited in the dialog (null = new event)
};

/* ==========================================================
   Helpers
   ========================================================== */

function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Dates are stored as local "YYYY-MM-DD" strings so "today" matches the officer's calendar.
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return toISODate(new Date());
}

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// Times are stored as 24-hour "HH:MM" strings.
function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatTime(time) {
  if (!time || !isValidTime(time)) return '';
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// "Oct 7, 2026 · 2:00 PM" (time left out for older events saved without one).
function formatEventWhen(event) {
  const time = formatTime(event.time);
  return time ? `${formatDate(event.date)} · ${time}` : formatDate(event.date);
}

// Events sort by date, then start time, then name.
function compareEventsBySchedule(a, b) {
  return a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.name.localeCompare(b.name);
}

function normalizeStudentId(value) {
  return String(value || '').trim().toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Every action returns one of these so the UI can show a success or error message.
function success(message) {
  return { ok: true, message, errors: [] };
}

function failure(message, errors) {
  return { ok: false, message, errors: errors || [message] };
}

/* ==========================================================
   Storage
   ========================================================== */

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEYS.events, JSON.stringify(state.events));
    localStorage.setItem(STORAGE_KEYS.registrations, JSON.stringify(state.registrations));
  } catch (err) {
    showMessage('Could not save to this browser. Changes will be lost on refresh.', 'error');
  }
}

function removeLegacyData() {
  try {
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch (err) {
    // Storage unavailable; nothing to clean up.
  }
}

// Deletes all events and registrations.
function clearAllData() {
  state.events = [];
  state.registrations = [];
  saveData();
  return success('All events and registrations cleared.');
}

function loadData() {
  removeLegacyData();
  let events = null;
  let registrations = null;
  try {
    events = JSON.parse(localStorage.getItem(STORAGE_KEYS.events));
    registrations = JSON.parse(localStorage.getItem(STORAGE_KEYS.registrations));
  } catch (err) {
    events = null;
  }

  // First run (or unreadable data) starts empty.
  state.events = Array.isArray(events) ? events : [];
  state.registrations = Array.isArray(registrations) ? registrations : [];
}

/* ==========================================================
   Queries & computed stats
   ========================================================== */

function getEventById(eventId) {
  return state.events.find((event) => event.id === eventId) || null;
}

function getRegistrationById(registrationId) {
  return state.registrations.find((reg) => reg.id === registrationId) || null;
}

function getRegistrationsForEvent(eventId) {
  return state.registrations.filter((reg) => reg.eventId === eventId);
}

function findRegistration(eventId, studentId) {
  const id = normalizeStudentId(studentId);
  return state.registrations.find((reg) => reg.eventId === eventId && reg.studentId === id) || null;
}

// Rule 8: attendance rate = present / registered x 100, rounded to 1 decimal; 0 when nobody registered.
function computeAttendanceRate(present, registered) {
  if (registered === 0) return 0;
  return Math.round((present / registered) * 1000) / 10;
}

// Rule 8: all counts are computed from the registrations every time, never stored.
function computeEventStats(event) {
  const regs = getRegistrationsForEvent(event.id);
  const registered = regs.length;
  const present = regs.filter((reg) => reg.present).length;
  return {
    registered,
    slotsLeft: Math.max(event.capacity - registered, 0),
    present,
    attendanceRate: computeAttendanceRate(present, registered),
  };
}

function formatRate(stats) {
  return stats.registered === 0 ? '0%' : `${stats.attendanceRate.toFixed(1)}%`;
}

/* ==========================================================
   Event rules
   ========================================================== */

function validateEventInput(input, existingEvent) {
  const errors = [];
  const name = String(input.name || '').trim();
  const venue = String(input.venue || '').trim();
  const date = String(input.date || '').trim();
  const time = String(input.time || '').trim();
  const capacityText = String(input.capacity ?? '').trim();

  if (!name) errors.push('Event name is required.');
  else if (name.length > 100) errors.push('Event name must be 100 characters or fewer.');

  if (!date) errors.push('Date is required.');
  else if (!isValidISODate(date)) errors.push('Date is not a valid date.');

  if (!time) errors.push('Time is required.');
  else if (!isValidTime(time)) errors.push('Time is not a valid time.');

  if (!venue) errors.push('Venue is required.');
  else if (venue.length > 100) errors.push('Venue must be 100 characters or fewer.');

  if (!capacityText) {
    errors.push('Capacity is required.');
  } else {
    const capacity = Number(capacityText);
    if (!Number.isInteger(capacity) || capacity < 1) {
      errors.push('Capacity must be a whole number of at least 1.');
    } else if (existingEvent) {
      // Editing: capacity cannot drop below the students already registered.
      const { registered } = computeEventStats(existingEvent);
      if (capacity < registered) {
        errors.push(`Capacity cannot be lower than the ${registered} students already registered.`);
      }
    }
  }
  return errors;
}

function createEvent(input) {
  const errors = validateEventInput(input, null);
  if (errors.length) return failure('Please fix the event details.', errors);

  const event = {
    id: generateId('evt'),
    name: input.name.trim(),
    date: input.date.trim(),
    time: input.time.trim(),
    venue: input.venue.trim(),
    capacity: Number(input.capacity),
    status: 'Draft', // Rule 1: every new event starts as Draft
  };
  state.events.push(event);
  saveData();
  return success(`Event "${event.name}" created as Draft.`);
}

// Edits name, date, time, venue and capacity only. Status changes go through changeEventStatus (Rule 1).
function updateEvent(eventId, input) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');

  const errors = validateEventInput(input, event);
  if (errors.length) return failure('Please fix the event details.', errors);

  event.name = input.name.trim();
  event.date = input.date.trim();
  event.time = input.time.trim();
  event.venue = input.venue.trim();
  event.capacity = Number(input.capacity);
  saveData();
  return success(`Event "${event.name}" updated.`);
}

// Rule 7: an event with registrations cannot be deleted.
function deleteEvent(eventId) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');

  if (getRegistrationsForEvent(eventId).length > 0) {
    return failure('This event has registrations and cannot be deleted. Set this event to Completed instead.');
  }

  state.events = state.events.filter((e) => e.id !== eventId);
  saveData();
  return success(`Event "${event.name}" deleted.`);
}

// Rule 1: returns the single status that may follow the current one (null after Completed).
function getNextStatus(status) {
  const index = STATUS_FLOW.indexOf(status);
  if (index === -1 || index === STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[index + 1];
}

// Rule 1: status moves forward one step at a time. No skipping, no going backward.
function changeEventStatus(eventId, newStatus) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');
  if (!STATUS_FLOW.includes(newStatus)) return failure(`"${newStatus}" is not a valid status.`);

  if (getNextStatus(event.status) !== newStatus) {
    return failure(
      `Cannot change status from ${STATUS_LABELS[event.status]} to ${STATUS_LABELS[newStatus]}. ` +
      'Status must move Draft → Open for Registration → Closed → Completed, one step at a time.'
    );
  }

  event.status = newStatus;
  saveData();
  return success(`"${event.name}" is now ${STATUS_LABELS[newStatus]}.`);
}

function advanceEventStatus(eventId) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');
  const next = getNextStatus(event.status);
  if (!next) return failure('This event is already Completed. Completed is the final status.');
  return changeEventStatus(eventId, next);
}

/* ==========================================================
   Registration rules
   ========================================================== */

function validateRegistrationInput(input) {
  const errors = [];
  const name = String(input.studentName || '').trim();
  const studentId = normalizeStudentId(input.studentId);
  const yearText = String(input.yearLevel ?? '').trim();

  if (!name) errors.push('Student name is required.');
  else if (name.length > 80) errors.push('Student name must be 80 characters or fewer.');

  if (!studentId) errors.push('Student ID is required.');
  else if (!STUDENT_ID_PATTERN.test(studentId)) {
    errors.push('Student ID must be 3–20 characters using letters, numbers, or dashes.');
  }

  const year = Number(yearText);
  if (!yearText) errors.push('Year level is required.');
  else if (!Number.isInteger(year) || year < 1 || year > 5) errors.push('Year level must be from 1 to 5.');

  return errors;
}

function registerStudent(eventId, input) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');

  const errors = validateRegistrationInput(input);
  if (errors.length) return failure('Please fix the registration details.', errors);

  // Rule 2: registration only while the event is Open.
  if (event.status !== 'Open') {
    return failure(`Registration is not available. This event is ${STATUS_LABELS[event.status]}; students can register only while it is Open for Registration.`);
  }

  // Rule 4: the same student ID cannot register twice for the same event.
  const existing = findRegistration(eventId, input.studentId);
  if (existing) {
    return failure(`Student ID ${existing.studentId} is already registered for this event (${existing.studentName}).`);
  }

  // Rule 3: only while registered count is below capacity.
  if (computeEventStats(event).registered >= event.capacity) {
    return failure('This event is full');
  }

  const registration = {
    id: generateId('reg'),
    eventId,
    studentName: input.studentName.trim(),
    studentId: normalizeStudentId(input.studentId),
    yearLevel: Number(input.yearLevel),
    dateRegistered: todayISO(),
    present: false,
  };
  state.registrations.push(registration);
  saveData();
  return success(`${registration.studentName} registered for "${event.name}".`);
}

// Rule 5: cancelling removes the registration; the slot frees up because counts are computed.
function cancelRegistration(registrationId) {
  const reg = getRegistrationById(registrationId);
  if (!reg) return failure('Registration not found.');

  const event = getEventById(reg.eventId);
  // Completed events keep their registrations as the final attendance record.
  if (event && event.status === 'Completed') {
    return failure('Registrations for a Completed event are kept as its attendance record and cannot be cancelled.');
  }

  state.registrations = state.registrations.filter((r) => r.id !== registrationId);
  saveData();
  return success(`Registration for ${reg.studentName} cancelled. One slot freed.`);
}

/* ==========================================================
   Check-in rules (Rule 6)
   ========================================================== */

// Rule 6: check-in happens only on the event's date.
function isEventToday(event) {
  return event.date === todayISO();
}

function checkInStudent(eventId, studentId) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');

  const id = normalizeStudentId(studentId);
  if (!id) return failure('Enter a student ID to check in.');

  // Rule 6: only on the event date.
  if (!isEventToday(event)) {
    return failure(`Check-in is only allowed on the event date (${formatDate(event.date)}).`);
  }

  // Rule 6: only students registered for this event.
  const reg = findRegistration(eventId, id);
  if (!reg) return failure('Student is not registered for this event.');

  if (reg.present) return failure(`${reg.studentName} is already marked Present.`);

  reg.present = true;
  saveData();
  return success(`${reg.studentName} checked in as Present.`);
}

// Rule 6: officers can undo Present (same event-date restriction applies).
function undoPresent(registrationId) {
  const reg = getRegistrationById(registrationId);
  if (!reg) return failure('Registration not found.');

  const event = getEventById(reg.eventId);
  if (!event) return failure('Event not found.');

  if (!isEventToday(event)) {
    return failure(`Attendance can only be changed on the event date (${formatDate(event.date)}).`);
  }
  if (!reg.present) return failure(`${reg.studentName} is not marked Present.`);

  reg.present = false;
  saveData();
  return success(`Present undone for ${reg.studentName}.`);
}

function toggleAttendance(registrationId) {
  const reg = getRegistrationById(registrationId);
  if (!reg) return failure('Registration not found.');
  return reg.present ? undoPresent(registrationId) : checkInStudent(reg.eventId, reg.studentId);
}

/* ==========================================================
   Report
   ========================================================== */

function countEventsByStatus() {
  const counts = {};
  STATUS_FLOW.forEach((status) => { counts[status] = 0; });
  state.events.forEach((event) => { counts[event.status] = (counts[event.status] || 0) + 1; });
  return counts;
}

// Completed event with the highest attendance rate (ties: more students present wins).
function findTopCompletedEvent() {
  let best = null;
  state.events
    .filter((event) => event.status === 'Completed')
    .forEach((event) => {
      const stats = computeEventStats(event);
      if (
        !best ||
        stats.attendanceRate > best.stats.attendanceRate ||
        (stats.attendanceRate === best.stats.attendanceRate && stats.present > best.stats.present)
      ) {
        best = { event, stats };
      }
    });
  return best;
}

/* ==========================================================
   CSV export
   ========================================================== */

// Quotes a cell when needed. Text starting with = + - @ is prefixed with '
// so spreadsheet apps don't run it as a formula.
function toCsvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Builds the attendance list for one event, all registrations, sorted by name.
function buildAttendanceCsv(event) {
  const header = ['Student Name', 'Student ID', 'Year Level', 'Date Registered', 'Attendance'];
  const rows = getRegistrationsForEvent(event.id)
    .slice()
    .sort((a, b) => a.studentName.localeCompare(b.studentName))
    .map((reg) => [reg.studentName, reg.studentId, reg.yearLevel, reg.dateRegistered, reg.present ? 'Present' : 'Absent']);
  return [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\r\n');
}

function makeCsvFileName(event) {
  const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
  return `${slug}-${event.date}-attendance.csv`;
}

function exportAttendanceCsv(eventId) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');

  const count = getRegistrationsForEvent(eventId).length;
  if (count === 0) return failure('No registrations to export yet.');

  // The BOM makes Excel read the file as UTF-8 (keeps accented names intact).
  const blob = new Blob(['﻿' + buildAttendanceCsv(event)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = makeCsvFileName(event);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return success(`Exported ${count} registration${count === 1 ? '' : 's'} to ${link.download}.`);
}

/* ==========================================================
   UI: icons & shared bits
   ========================================================== */

const dom = {};

// Small inline SVG icons (stroke style, inherit currentColor).
const ICONS = {
  calendar: '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  alert: '<path d="M12 8v5M12 16.5v.5"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  open: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

function icon(name, size = 16, strokeWidth = 2) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function cacheDom() {
  const ids = [
    'add-event-btn', 'events-tbody', 'events-empty', 'events-overview', 'status-chips', 'event-search',
    'events-list-view', 'event-detail-view', 'back-to-list',
    'detail-name', 'detail-status', 'detail-meta', 'detail-stats', 'detail-stepper',
    'advance-status-btn', 'edit-event-btn', 'delete-event-btn',
    'registration-form', 'registration-fieldset', 'registration-hint', 'registration-errors',
    'checkin-form', 'checkin-fieldset', 'checkin-hint', 'checkin-student-id',
    'reg-search', 'attendance-filter', 'registrations-tbody', 'registrations-empty', 'registrations-count',
    'panel-events', 'panel-report', 'status-counts', 'top-attendance',
    'event-dialog', 'event-form', 'event-form-title', 'event-status-note',
    'event-errors', 'event-cancel-btn', 'event-close-btn', 'toast-region', 'reset-data-btn', 'export-csv-btn',
  ];
  ids.forEach((id) => {
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    dom[key] = document.getElementById(id);
  });
}

/* ==========================================================
   UI: messages
   ========================================================== */

function dismissToast(toast) {
  if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
  toast.classList.add('is-leaving');
  setTimeout(() => toast.remove(), 250);
}

function showMessage(message, type = 'success') {
  const isError = type === 'error';
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' toast-error' : ''}`;
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.innerHTML = `
    <span class="toast-icon">${icon(isError ? 'alert' : 'check', 14, 3)}</span>
    <span class="toast-text"></span>
    <button type="button" class="icon-btn" aria-label="Dismiss">${icon('x', 14, 2.4)}</button>`;
  toast.querySelector('.toast-text').textContent = message;
  toast.querySelector('button').addEventListener('click', () => dismissToast(toast));
  dom.toastRegion.appendChild(toast);

  // Errors stay a little longer so they can be read.
  setTimeout(() => dismissToast(toast), isError ? TOAST_DURATION_MS + 2000 : TOAST_DURATION_MS);
}

// Shows the result of an action as a toast. Returns true when it succeeded.
function showResult(result) {
  showMessage(result.message, result.ok ? 'success' : 'error');
  return result.ok;
}

function showFormErrors(container, errors) {
  if (!errors || errors.length === 0) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `<ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  container.hidden = false;
}

function renderStatusBadge(status) {
  return `<span class="badge badge-${status.toLowerCase()}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

function renderMeter(percent, extraClass = '') {
  const width = Math.max(0, Math.min(100, percent));
  return `<div class="meter ${extraClass}"><span style="width:${width}%"></span></div>`;
}

function renderStat(label, value, sub, meterHtml) {
  return `
    <div class="stat">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ''}
      ${meterHtml || ''}
    </div>`;
}

function renderEmptyState(iconName, title, text, buttonHtml = '') {
  return `
    <span class="empty-icon">${icon(iconName, 26, 1.8)}</span>
    <h4>${escapeHtml(title)}</h4>
    <p>${escapeHtml(text)}</p>
    ${buttonHtml}`;
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0] || '')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Same student ID always gets the same avatar colour.
function getAvatarTone(studentId) {
  const tones = ['tone-indigo', 'tone-green', 'tone-amber', 'tone-blue', 'tone-gray'];
  let hash = 0;
  for (const ch of studentId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

/* ==========================================================
   UI: events list
   ========================================================== */

function renderOverview() {
  const counts = countEventsByStatus();
  const today = todayISO();
  const todayCount = state.events.filter((e) => e.date === today).length;
  const upcoming = state.events.filter((e) => e.date > today && e.status !== 'Completed').length;

  const cards = [
    ['Total events', state.events.length, 'layers', 'tone-indigo'],
    ['Open for registration', counts.Open, 'open', 'tone-green'],
    ['Happening today', todayCount, 'sun', 'tone-amber'],
    ['Upcoming', upcoming, 'clock', 'tone-blue'],
  ];
  dom.eventsOverview.innerHTML = cards.map(([label, value, iconName, tone]) => `
    <div class="overview-card">
      <span class="overview-icon ${tone}">${icon(iconName, 20)}</span>
      <div>
        <div class="overview-label">${escapeHtml(label)}</div>
        <div class="overview-value">${value}</div>
      </div>
    </div>`).join('');
}

function renderStatusChips() {
  const counts = countEventsByStatus();
  const chips = [['All', 'All', state.events.length], ...STATUS_FLOW.map((s) => [s, STATUS_LABELS[s], counts[s]])];
  dom.statusChips.innerHTML = chips.map(([value, label, count]) => `
    <button type="button" class="chip${state.statusFilter === value ? ' is-active' : ''}" data-status="${value}" aria-pressed="${state.statusFilter === value}">
      ${escapeHtml(label)} <span class="chip-count">${count}</span>
    </button>`).join('');
}

function renderEventsTable() {
  renderOverview();
  renderStatusChips();

  const query = dom.eventSearch.value.trim().toLowerCase();
  const today = todayISO();
  const events = state.events
    .filter((event) => state.statusFilter === 'All' || event.status === state.statusFilter)
    .filter((event) => !query ||
      event.name.toLowerCase().includes(query) ||
      event.venue.toLowerCase().includes(query))
    .sort(compareEventsBySchedule);

  dom.eventsTbody.innerHTML = events.map((event) => {
    const stats = computeEventStats(event);
    const isFull = stats.slotsLeft === 0;
    const fillPct = (stats.registered / event.capacity) * 100;
    const todayPill = event.date === today ? '<span class="badge today-pill">Today</span>' : '';
    return `
      <tr data-event-id="${escapeHtml(event.id)}">
        <td class="cell-main">
          <button type="button" class="event-name">${escapeHtml(event.name)}</button>
          <div class="event-venue">${icon('pin', 13)}${escapeHtml(event.venue)}</div>
        </td>
        <td class="date-cell" data-label="Date &amp; time">
          <div>
            <div>${escapeHtml(formatDate(event.date))}${todayPill}</div>
            ${event.time ? `<div class="event-time">${icon('clock', 13)}${escapeHtml(formatTime(event.time))}</div>` : ''}
          </div>
        </td>
        <td data-label="Status">${renderStatusBadge(event.status)}</td>
        <td class="meter-cell" data-label="Registered">
          <div>
            <div class="meter-text"><span>${stats.registered} / ${event.capacity}</span></div>
            ${renderMeter(fillPct, isFull ? 'meter-full' : '')}
          </div>
        </td>
        <td class="num" data-label="Slots left">${isFull ? '<span class="badge badge-full badge-plain">Full</span>' : stats.slotsLeft}</td>
        <td class="num" data-label="Present">${stats.present}</td>
        <td class="meter-cell" data-label="Attendance rate">
          <div>
            <div class="meter-text"><span>${formatRate(stats)}</span></div>
            ${renderMeter(stats.attendanceRate, 'meter-green')}
          </div>
        </td>
        <td class="chevron-cell"><span class="chevron">${icon('chevron', 18)}</span></td>
      </tr>`;
  }).join('');

  const hasEvents = state.events.length > 0;
  dom.eventsEmpty.hidden = events.length > 0;
  dom.eventsTbody.closest('.table-wrap').hidden = events.length === 0;
  dom.eventsEmpty.innerHTML = hasEvents
    ? renderEmptyState('search', 'No matching events', 'Try a different status or search term.')
    : renderEmptyState('calendar', 'No events yet', 'Create your first event, then open it for registration so students can sign up.',
      `<button type="button" class="btn btn-primary" data-action="new-event">${icon('plus', 16, 2.5)} Create event</button>`);
}

/* ==========================================================
   UI: event details
   ========================================================== */

function renderStepper(status) {
  const currentIndex = STATUS_FLOW.indexOf(status);
  dom.detailStepper.innerHTML = STATUS_FLOW.map((step, i) => {
    const cls = i < currentIndex ? 'is-done' : i === currentIndex ? 'is-current' : '';
    const mark = i < currentIndex ? icon('check', 13, 3) : '';
    return `
      <li class="step ${cls}"${i === currentIndex ? ' aria-current="step"' : ''}>
        <span class="step-bar"></span>
        <span class="step-label">${mark}${escapeHtml(STATUS_LABELS[step])}</span>
      </li>`;
  }).join('');
}

function renderEventDetails() {
  const event = getEventById(state.selectedEventId);
  if (!event) {
    closeEventDetails();
    return;
  }
  const stats = computeEventStats(event);
  const isToday = isEventToday(event);
  const isFull = stats.slotsLeft === 0;

  dom.detailName.textContent = event.name;
  dom.detailStatus.innerHTML = renderStatusBadge(event.status) +
    (isToday ? ' <span class="badge today-pill">Today</span>' : '');
  dom.detailMeta.innerHTML = `
    <span>${icon('calendar', 15)}${escapeHtml(formatDate(event.date))}</span>
    ${event.time ? `<span>${icon('clock', 15)}${escapeHtml(formatTime(event.time))}</span>` : ''}
    <span>${icon('pin', 15)}${escapeHtml(event.venue)}</span>
    <span>${icon('users', 15)}${event.capacity} capacity</span>`;
  renderStepper(event.status);

  dom.detailStats.innerHTML = [
    renderStat('Registered', String(stats.registered), `of ${event.capacity} capacity`,
      renderMeter((stats.registered / event.capacity) * 100, isFull ? 'meter-full' : '')),
    renderStat('Slots left', String(stats.slotsLeft), isFull ? 'Event is full' : 'available'),
    renderStat('Present', String(stats.present), `${stats.registered - stats.present} absent`),
    renderStat('Attendance rate', formatRate(stats), `${stats.present} of ${stats.registered}`,
      renderMeter(stats.attendanceRate, 'meter-green')),
    renderStat('Capacity', String(event.capacity), 'max students'),
  ].join('');

  const next = getNextStatus(event.status);
  dom.advanceStatusBtn.hidden = !next;
  if (next) dom.advanceStatusBtn.textContent = `Move to ${STATUS_LABELS[next]}`;

  // The forms are disabled when their rule can't pass; the data functions still enforce every rule.
  const registrationOpen = event.status === 'Open';
  dom.registrationFieldset.disabled = !registrationOpen;
  dom.registrationHint.textContent = !registrationOpen
    ? 'Registration is available only while the event is Open for Registration.'
    : isFull
      ? 'This event is full.'
      : `${stats.slotsLeft} slot${stats.slotsLeft === 1 ? '' : 's'} left.`;

  dom.checkinFieldset.disabled = !isToday;
  dom.checkinHint.textContent = isToday
    ? 'Event is today. Enter or scan a registered student ID.'
    : `Check-in opens on the event date (${formatDate(event.date)}).`;

  renderRegistrationsTable(event);
}

function renderRegistrationsTable(event) {
  const query = dom.regSearch.value.trim().toLowerCase();
  const attendance = dom.attendanceFilter.value;
  const allRegs = getRegistrationsForEvent(event.id);
  const canChangeAttendance = isEventToday(event);
  const canCancel = event.status !== 'Completed';

  const regs = allRegs
    .filter((reg) => !query ||
      reg.studentName.toLowerCase().includes(query) ||
      reg.studentId.toLowerCase().includes(query))
    .filter((reg) => attendance === 'All' ||
      (attendance === 'Present' && reg.present) ||
      (attendance === 'Absent' && !reg.present))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));

  dom.registrationsCount.textContent = allRegs.length;

  dom.registrationsTbody.innerHTML = regs.map((reg) => {
    const attendanceBtn = canChangeAttendance
      ? (reg.present
        ? `<button type="button" class="btn btn-sm" data-action="toggle" data-reg-id="${escapeHtml(reg.id)}">Undo Present</button>`
        : `<button type="button" class="btn btn-sm btn-toggle-present" data-action="toggle" data-reg-id="${escapeHtml(reg.id)}">${icon('check', 14, 2.6)}Check in</button>`)
      : '';
    const cancelBtn = canCancel
      ? `<button type="button" class="btn btn-sm btn-ghost-danger" data-action="cancel" data-reg-id="${escapeHtml(reg.id)}">Cancel</button>`
      : '';
    const actions = attendanceBtn || cancelBtn ? `<td class="actions">${attendanceBtn}${cancelBtn}</td>` : '<td></td>';
    return `
      <tr>
        <td class="cell-main">
          <div class="student">
            <span class="avatar ${getAvatarTone(reg.studentId)}" aria-hidden="true">${escapeHtml(getInitials(reg.studentName))}</span>
            <div>
              <div class="student-name">${escapeHtml(reg.studentName)}</div>
              <div class="student-id">${escapeHtml(reg.studentId)}</div>
            </div>
          </div>
        </td>
        <td data-label="Year">Year ${reg.yearLevel}</td>
        <td class="nowrap" data-label="Registered on">${escapeHtml(formatDate(reg.dateRegistered))}</td>
        <td data-label="Attendance"><span class="badge ${reg.present ? 'badge-present' : 'badge-absent'}">${reg.present ? 'Present' : 'Absent'}</span></td>
        ${actions}
      </tr>`;
  }).join('');

  dom.registrationsEmpty.hidden = regs.length > 0;
  dom.registrationsTbody.closest('.table-wrap').hidden = regs.length === 0;
  dom.registrationsEmpty.innerHTML = allRegs.length === 0
    ? renderEmptyState('users', 'No students registered yet',
      event.status === 'Open' ? 'Use the form above to register the first student.' : 'Open the event for registration to start signing students up.')
    : renderEmptyState('search', 'No matches', 'No registrations match your search or filter.');
}

function openEventDetails(eventId) {
  state.selectedEventId = eventId;
  dom.regSearch.value = '';
  dom.attendanceFilter.value = 'All';
  dom.registrationForm.reset();
  dom.checkinForm.reset();
  showFormErrors(dom.registrationErrors, []);
  dom.eventsListView.hidden = true;
  dom.eventDetailView.hidden = false;
  renderEventDetails();
  window.scrollTo(0, 0);

  // On event day, put the cursor straight into the check-in box (works with ID scanners).
  const event = getEventById(eventId);
  if (event && isEventToday(event)) dom.checkinStudentId.focus({ preventScroll: true });
}

function closeEventDetails() {
  state.selectedEventId = null;
  dom.eventDetailView.hidden = true;
  dom.eventsListView.hidden = false;
  renderEventsTable();
}

/* ==========================================================
   UI: report
   ========================================================== */

function renderReport() {
  const counts = countEventsByStatus();
  const total = state.events.length;

  const segments = total === 0 ? '' : STATUS_FLOW
    .filter((s) => counts[s] > 0)
    .map((s) => `<span class="seg-${s.toLowerCase()}" style="width:${(counts[s] / total) * 100}%" title="${STATUS_LABELS[s]}: ${counts[s]}"></span>`)
    .join('');

  dom.statusCounts.innerHTML = `
    <div class="status-bar" aria-hidden="true">${segments}</div>
    <ul class="status-list">
      ${STATUS_FLOW.map((s) => `
        <li><span><span class="dot seg-${s.toLowerCase()}"></span>${escapeHtml(STATUS_LABELS[s])}</span><strong>${counts[s]}</strong></li>`).join('')}
      <li class="total"><span>Total events</span><strong>${total}</strong></li>
    </ul>`;

  const top = findTopCompletedEvent();
  if (!top) {
    dom.topAttendance.innerHTML = `<div class="empty-state empty-state-sm">${renderEmptyState('trophy', 'No completed events yet',
      'Once an event is marked Completed, the one with the best attendance shows up here.')}</div>`;
    return;
  }
  dom.topAttendance.innerHTML = `
    <div class="top-event">
      <div class="ring" style="--pct:${top.stats.attendanceRate}"><span>${formatRate(top.stats)}</span></div>
      <div>
        <span class="trophy">${icon('trophy', 13)}Top attendance</span>
        <h4>${escapeHtml(top.event.name)}</h4>
        <p>${escapeHtml(formatEventWhen(top.event))} · ${escapeHtml(top.event.venue)}</p>
        <p>${top.stats.present} present of ${top.stats.registered} registered</p>
      </div>
    </div>`;
}

/* ==========================================================
   UI: render everything (counts update live after every action)
   ========================================================== */

function renderAll() {
  renderEventsTable();
  if (state.selectedEventId) renderEventDetails();
  renderReport();
}

/* ==========================================================
   UI: tabs
   ========================================================== */

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  dom.panelEvents.hidden = tabName !== 'events';
  dom.panelReport.hidden = tabName !== 'report';
  if (tabName === 'report') renderReport();
}

/* ==========================================================
   UI: event dialog (add / edit)
   ========================================================== */

function openEventDialog(event) {
  state.editingEventId = event ? event.id : null;
  dom.eventForm.reset();
  showFormErrors(dom.eventErrors, []);
  clearInvalidMarks(dom.eventForm);

  dom.eventFormTitle.textContent = event ? 'Edit event' : 'New event';
  dom.eventForm.elements.name.value = event ? event.name : '';
  dom.eventForm.elements.date.value = event ? event.date : '';
  dom.eventForm.elements.time.value = event ? (event.time || '') : '';
  dom.eventForm.elements.venue.value = event ? event.venue : '';
  dom.eventForm.elements.capacity.value = event ? event.capacity : '';
  dom.eventStatusNote.textContent = event
    ? `Status: ${STATUS_LABELS[event.status]}. Use "Move to…" on the event page to change status.`
    : 'New events start as Draft.';

  dom.eventDialog.showModal();
  dom.eventForm.elements.name.focus();
}

function closeEventDialog() {
  dom.eventDialog.close();
  state.editingEventId = null;
}

function readEventForm() {
  const f = dom.eventForm.elements;
  return { name: f.name.value, date: f.date.value, time: f.time.value, venue: f.venue.value, capacity: f.capacity.value };
}

// Marks fields whose name appears in an error message, so officers can spot them quickly.
function markInvalidFields(form, errors, fieldWords) {
  clearInvalidMarks(form);
  Object.entries(fieldWords).forEach(([field, word]) => {
    if (errors.some((e) => e.toLowerCase().startsWith(word))) {
      form.elements[field].setAttribute('aria-invalid', 'true');
    }
  });
}

function clearInvalidMarks(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

function handleEventFormSubmit(e) {
  e.preventDefault();
  const input = readEventForm();
  const result = state.editingEventId
    ? updateEvent(state.editingEventId, input)
    : createEvent(input);

  if (!result.ok) {
    showFormErrors(dom.eventErrors, result.errors);
    markInvalidFields(dom.eventForm, result.errors, {
      name: 'event name', date: 'date', time: 'time', venue: 'venue', capacity: 'capacity',
    });
    showResult(result);
    return;
  }
  closeEventDialog();
  showResult(result);
  renderAll();
}

/* ==========================================================
   UI: event handlers
   ========================================================== */

function handleRegistrationSubmit(e) {
  e.preventDefault();
  const f = dom.registrationForm.elements;
  const result = registerStudent(state.selectedEventId, {
    studentName: f.studentName.value,
    studentId: f.studentId.value,
    yearLevel: f.yearLevel.value,
  });

  if (result.ok) {
    dom.registrationForm.reset();
    clearInvalidMarks(dom.registrationForm);
    showFormErrors(dom.registrationErrors, []);
    dom.registrationForm.elements.studentName.focus(); // ready for the next student
  } else {
    showFormErrors(dom.registrationErrors, result.errors);
    markInvalidFields(dom.registrationForm, result.errors, {
      studentName: 'student name', studentId: 'student id', yearLevel: 'year level',
    });
  }
  showResult(result);
  renderAll();
}

function handleCheckInSubmit(e) {
  e.preventDefault();
  const result = checkInStudent(state.selectedEventId, dom.checkinStudentId.value);
  if (result.ok) dom.checkinForm.reset();
  showResult(result);
  renderAll();
  dom.checkinStudentId.focus();
}

function handleRegistrationTableClick(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const regId = button.dataset.regId;

  if (button.dataset.action === 'cancel') {
    const reg = getRegistrationById(regId);
    if (!reg || !confirm(`Cancel the registration for ${reg.studentName}?`)) return;
    showResult(cancelRegistration(regId));
  } else if (button.dataset.action === 'toggle') {
    showResult(toggleAttendance(regId));
  }
  renderAll();
}

function handleStatusChipClick(e) {
  const chip = e.target.closest('[data-status]');
  if (!chip) return;
  state.statusFilter = chip.dataset.status;
  renderEventsTable();
}

function handleEventsTableClick(e) {
  const row = e.target.closest('tr[data-event-id]');
  if (row) openEventDetails(row.dataset.eventId);
}

function handleAdvanceStatus() {
  const event = getEventById(state.selectedEventId);
  if (!event) return;
  const next = getNextStatus(event.status);
  if (next && !confirm(`Move "${event.name}" to ${STATUS_LABELS[next]}? Status cannot go back.`)) return;
  showResult(advanceEventStatus(event.id));
  renderAll();
}

function handleDeleteEvent() {
  const event = getEventById(state.selectedEventId);
  if (!event) return;

  // Checked first so the officer sees the rule instead of a pointless confirm.
  if (getRegistrationsForEvent(event.id).length > 0) {
    showResult(deleteEvent(event.id));
    return;
  }
  if (!confirm(`Delete "${event.name}"? This cannot be undone.`)) return;
  if (showResult(deleteEvent(event.id))) closeEventDetails();
  renderAll();
}

function handleResetData() {
  if (!confirm('Delete all events and registrations? This cannot be undone.')) return;
  showResult(clearAllData());
  closeEventDetails();
  renderAll();
}

function bindEvents() {
  dom.resetDataBtn.addEventListener('click', handleResetData);
  dom.exportCsvBtn.addEventListener('click', () => showResult(exportAttendanceCsv(state.selectedEventId)));
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  dom.statusChips.addEventListener('click', handleStatusChipClick);
  dom.eventSearch.addEventListener('input', renderEventsTable);
  dom.addEventBtn.addEventListener('click', () => openEventDialog(null));
  dom.eventsTbody.addEventListener('click', handleEventsTableClick);
  dom.eventsEmpty.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="new-event"]')) openEventDialog(null);
  });

  dom.backToList.addEventListener('click', closeEventDetails);
  dom.advanceStatusBtn.addEventListener('click', handleAdvanceStatus);
  dom.editEventBtn.addEventListener('click', () => openEventDialog(getEventById(state.selectedEventId)));
  dom.deleteEventBtn.addEventListener('click', handleDeleteEvent);

  dom.registrationForm.addEventListener('submit', handleRegistrationSubmit);
  dom.checkinForm.addEventListener('submit', handleCheckInSubmit);
  dom.regSearch.addEventListener('input', () => renderEventDetails());
  dom.attendanceFilter.addEventListener('change', () => renderEventDetails());
  dom.registrationsTbody.addEventListener('click', handleRegistrationTableClick);

  dom.eventForm.addEventListener('submit', handleEventFormSubmit);
  dom.eventCancelBtn.addEventListener('click', closeEventDialog);
  dom.eventCloseBtn.addEventListener('click', closeEventDialog);
}

/* ==========================================================
   Init
   ========================================================== */

function init() {
  cacheDom();
  loadData();
  bindEvents();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
