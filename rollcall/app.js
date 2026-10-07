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
  const capacityText = String(input.capacity ?? '').trim();

  if (!name) errors.push('Event name is required.');
  else if (name.length > 100) errors.push('Event name must be 100 characters or fewer.');

  if (!date) errors.push('Date is required.');
  else if (!isValidISODate(date)) errors.push('Date is not a valid date.');

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
    venue: input.venue.trim(),
    capacity: Number(input.capacity),
    status: 'Draft', // Rule 1: every new event starts as Draft
  };
  state.events.push(event);
  saveData();
  return success(`Event "${event.name}" created as Draft.`);
}

// Edits name, date, venue and capacity only. Status changes go through changeEventStatus (Rule 1).
function updateEvent(eventId, input) {
  const event = getEventById(eventId);
  if (!event) return failure('Event not found.');

  const errors = validateEventInput(input, event);
  if (errors.length) return failure('Please fix the event details.', errors);

  event.name = input.name.trim();
  event.date = input.date.trim();
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
   UI: messages
   ========================================================== */

const dom = {};

function cacheDom() {
  const ids = [
    'status-filter', 'add-event-btn', 'events-tbody', 'events-empty',
    'events-list-view', 'event-detail-view', 'back-to-list',
    'detail-name', 'detail-status', 'detail-meta', 'detail-stats',
    'advance-status-btn', 'edit-event-btn', 'delete-event-btn',
    'registration-form', 'registration-hint', 'registration-errors',
    'checkin-form', 'checkin-hint', 'checkin-student-id',
    'reg-search', 'attendance-filter', 'registrations-tbody', 'registrations-empty',
    'panel-events', 'panel-report', 'status-counts', 'top-attendance',
    'event-dialog', 'event-form', 'event-form-title', 'event-status-note',
    'event-errors', 'event-cancel-btn', 'toast-region', 'reset-data-btn', 'export-csv-btn',
  ];
  ids.forEach((id) => {
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    dom[key] = document.getElementById(id);
  });
}

function showMessage(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' toast-error' : ''}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  dom.toastRegion.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 300);
  }, TOAST_DURATION_MS);
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

function renderStat(label, value, sub) {
  return `
    <div class="stat">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

/* ==========================================================
   UI: events list
   ========================================================== */

function renderEventsTable() {
  const filter = dom.statusFilter.value;
  const events = state.events
    .filter((event) => filter === 'All' || event.status === filter)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  dom.eventsTbody.innerHTML = events.map((event) => {
    const stats = computeEventStats(event);
    const fullBadge = stats.slotsLeft === 0 ? '<span class="badge badge-full">Full</span>' : '';
    return `
      <tr class="clickable" data-event-id="${escapeHtml(event.id)}">
        <td><button type="button" class="link-btn" data-open-event="${escapeHtml(event.id)}">${escapeHtml(event.name)}</button></td>
        <td>${escapeHtml(formatDate(event.date))}</td>
        <td>${escapeHtml(event.venue)}</td>
        <td>${renderStatusBadge(event.status)}</td>
        <td class="num">${stats.registered} / ${event.capacity}</td>
        <td class="num">${stats.slotsLeft}${fullBadge}</td>
        <td class="num">${stats.present}</td>
        <td class="num">${formatRate(stats)}</td>
      </tr>`;
  }).join('');

  dom.eventsEmpty.hidden = events.length > 0;
  dom.eventsEmpty.textContent = state.events.length === 0
    ? 'No events yet. Create your first event.'
    : 'No events match this filter.';
}

/* ==========================================================
   UI: event details
   ========================================================== */

function renderEventDetails() {
  const event = getEventById(state.selectedEventId);
  if (!event) {
    closeEventDetails();
    return;
  }
  const stats = computeEventStats(event);

  dom.detailName.textContent = event.name;
  dom.detailStatus.innerHTML = renderStatusBadge(event.status);
  dom.detailMeta.textContent = `${formatDate(event.date)} · ${event.venue}`;

  dom.detailStats.innerHTML = [
    renderStat('Capacity', String(event.capacity)),
    renderStat('Registered', String(stats.registered)),
    renderStat('Slots left', String(stats.slotsLeft), stats.slotsLeft === 0 ? 'Event is full' : ''),
    renderStat('Present', String(stats.present)),
    renderStat('Attendance rate', formatRate(stats), `${stats.present} of ${stats.registered}`),
  ].join('');

  const next = getNextStatus(event.status);
  dom.advanceStatusBtn.hidden = !next;
  if (next) dom.advanceStatusBtn.textContent = `Move to ${STATUS_LABELS[next]}`;

  dom.registrationHint.textContent = event.status !== 'Open'
    ? `Registration is closed. Students can register only while the event is Open for Registration.`
    : stats.slotsLeft === 0
      ? 'This event is full.'
      : `${stats.slotsLeft} slot${stats.slotsLeft === 1 ? '' : 's'} left.`;

  dom.checkinHint.textContent = isEventToday(event)
    ? 'Event is today. Check in registered students by ID, or use the buttons in the table.'
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

  dom.registrationsTbody.innerHTML = regs.map((reg) => {
    const attendanceBtn = canChangeAttendance
      ? `<button type="button" class="btn btn-sm" data-action="toggle" data-reg-id="${escapeHtml(reg.id)}">${reg.present ? 'Undo Present' : 'Check in'}</button>`
      : '';
    const cancelBtn = canCancel
      ? `<button type="button" class="btn btn-sm btn-danger" data-action="cancel" data-reg-id="${escapeHtml(reg.id)}">Cancel</button>`
      : '';
    return `
      <tr>
        <td>${escapeHtml(reg.studentName)}</td>
        <td>${escapeHtml(reg.studentId)}</td>
        <td class="num">${reg.yearLevel}</td>
        <td>${escapeHtml(formatDate(reg.dateRegistered))}</td>
        <td><span class="badge ${reg.present ? 'badge-present' : 'badge-absent'}">${reg.present ? 'Present' : 'Absent'}</span></td>
        <td class="actions">${attendanceBtn}${cancelBtn}</td>
      </tr>`;
  }).join('');

  dom.registrationsEmpty.hidden = regs.length > 0;
  dom.registrationsEmpty.textContent = allRegs.length === 0
    ? 'No students registered yet.'
    : 'No registrations match your search or filter.';
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
  dom.statusCounts.innerHTML = [
    renderStat('Total events', String(state.events.length)),
    ...STATUS_FLOW.map((status) => renderStat(STATUS_LABELS[status], String(counts[status]))),
  ].join('');

  const top = findTopCompletedEvent();
  if (!top) {
    dom.topAttendance.innerHTML = '<div class="card empty">No completed events yet</div>';
    return;
  }
  dom.topAttendance.innerHTML = `
    <div class="card highlight-card">
      <div>
        <h4>${escapeHtml(top.event.name)}</h4>
        <p class="muted">${escapeHtml(formatDate(top.event.date))} · ${escapeHtml(top.event.venue)}</p>
        <p class="muted">${top.stats.present} present of ${top.stats.registered} registered</p>
      </div>
      <div class="highlight-rate">${formatRate(top.stats)}</div>
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
  return { name: f.name.value, date: f.date.value, venue: f.venue.value, capacity: f.capacity.value };
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
      name: 'event name', date: 'date', venue: 'venue', capacity: 'capacity',
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

  dom.statusFilter.addEventListener('change', renderEventsTable);
  dom.addEventBtn.addEventListener('click', () => openEventDialog(null));
  dom.eventsTbody.addEventListener('click', handleEventsTableClick);

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
