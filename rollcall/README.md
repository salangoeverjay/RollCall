# RollCall

**Student Organization Event & Attendance Manager**

RollCall helps student organization officers run events from start to finish. Officers create an event, open registration, check students in on the day, and see attendance results. It's built with plain HTML, CSS and JavaScript only: no frameworks, no libraries and no backend. All data is saved in the browser.

---

## Features

- **Events:** create, edit and delete events. Each event moves through Draft → Open for Registration → Closed → Completed.
- **Registration:** register students with their name, student ID and year level. The app blocks duplicate IDs and stops registration when the event is full.
- **Check-in:** on the event day, mark students present by typing or scanning their ID, or from the registrations table. Officers can undo Present.
- **Live counts:** registered, slots left, present and attendance rate are recalculated from the data after every action.
- **Search and filters:**
  - Events can be filtered by status and searched by name or venue.
  - Registrations can be searched by name or student ID and filtered by attendance (All / Present / Absent).
- **CSV export:** download an event's attendance list to open in Excel or Google Sheets.
- **Report:** shows the number of events per status and the Completed event with the highest attendance rate.
- **Responsive:** works on desktop, tablet and phone. On small screens, tables turn into stacked cards.
- **Dark mode:** switches automatically when the device uses dark mode.

---

## Getting started

You don't need to install or build anything.

### Option 1: Open the file

Double-click `index.html` to open it in a modern browser, such as Chrome, Edge, Firefox or Safari.

### Option 2: Run a local server (recommended)

Some browsers limit storage for files opened directly from disk. To avoid that, serve the folder locally:

```bash
python -m http.server 5173
```

Then open <http://localhost:5173> in your browser.

The app starts empty. Click **New event** to begin.

---

## How to use

1. **Create an event.** Click **New event** and enter a name, venue, date and capacity. New events start as **Draft**.
2. **Open registration.** Open the event and click **Move to Open for Registration**.
3. **Register students.** Fill in the student's name, student ID and year level, then click **Register student**.
4. **Close registration.** Click **Move to Closed** when sign-ups end. You can skip this step if you want registration to stay open.
5. **Check students in on the event day.** Use one of these:
   - Type or scan a student ID in the **Check-in** box and press Enter.
   - Click **Check in** next to a student in the registrations table.
   - Click **Undo Present** to fix a mistake.
6. **Complete the event.** Click **Move to Completed**. The event then counts toward the Report's highest attendance.
7. **Export attendance.** In the **Registrations** section, click **Export CSV**.

---

## Business rules

Every rule is checked inside the JavaScript data functions, not only by hiding or disabling buttons.

| # | Rule | Where in `app.js` |
|---|------|-------------------|
| 1 | Status moves only Draft → Open for Registration → Closed → Completed. No skipping, no going backward. | `getNextStatus`, `changeEventStatus` |
| 2 | Students can register only while the event is **Open**. | `registerStudent` |
| 3 | Registration works only while registered < capacity. When full, the app shows *"This event is full"*. | `registerStudent` |
| 4 | The same student ID cannot register twice for the same event. | `registerStudent` |
| 5 | Cancelling removes the registration and frees a slot. | `cancelRegistration` |
| 6 | Check-in is allowed only on the event date, and only for registered students (*"Student is not registered for this event."*). Officers can undo Present. | `checkInStudent`, `undoPresent` |
| 7 | An event with registrations cannot be deleted (*"Set this event to Completed instead."*). | `deleteEvent` |
| 8 | Registered, slots left, present and attendance rate are always computed, never stored. Attendance rate = present ÷ registered × 100, rounded to 1 decimal, and 0% when there are no registrations. | `computeEventStats`, `computeAttendanceRate` |

**Rules the spec didn't cover:**
- Undo Present also only works on the event date.
- Registrations on a **Completed** event cannot be cancelled. They stay as the attendance record, and this also stops anyone from getting around rule 7.
- Capacity cannot be edited below the number of students already registered.

**Input validation:**
- Event name, venue and date are required.
- Capacity must be a whole number of at least 1.
- Student ID must be 3–20 letters, numbers or dashes.
- Year level must be 1–5.

---

## Data model

```text
Event
  id          string
  name        string
  date        "YYYY-MM-DD"
  venue       string
  capacity    number (≥ 1)
  status      "Draft" | "Open" | "Closed" | "Completed"   (default "Draft")

Registration
  id              string
  eventId         string  → Event.id
  studentName     string
  studentId       string  (stored uppercase)
  yearLevel       1–5
  dateRegistered  "YYYY-MM-DD"
  present         boolean (default false)
```

Data is saved in `localStorage` under two keys:
- `rollcall.v3.events`
- `rollcall.v3.registrations`

---

## CSV export format

**File name:** `<event-name>-<date>-attendance.csv`, for example `general-assembly-2026-10-07-attendance.csv`.

```csv
Student Name,Student ID,Year Level,Date Registered,Attendance
Andrea Santos,2023-00142,2,2026-10-01,Present
Miguel Reyes,2022-00318,3,2026-09-30,Absent
```

- The file includes every registration for the event, sorted by name. The search box and filters don't affect it.
- It's saved as UTF-8 with a BOM, so Excel shows accented names correctly.
- Text that starts with `=`, `+`, `-` or `@` is saved as plain text, so a spreadsheet won't run it as a formula.

---

## Project structure

```text
rollcall/
├── index.html   Layout: header, Events tab (list + details), Report tab, event dialog
├── style.css    Design tokens, light/dark themes, components, responsive layout
├── app.js       State, storage, business rules, rendering, event handlers
├── README.md    This file
└── prompt.md    Prompt log from development
```

`app.js` is organized top to bottom in this order:

1. Constants
2. Helpers
3. Storage
4. Queries and computed stats
5. Event rules
6. Registration rules
7. Check-in rules
8. Report
9. CSV export
10. UI rendering
11. Event handlers
12. Init

---

## Resetting data

To delete every event and registration, go to the **Report** tab and click **Clear all data**. This cannot be undone.

---

## Limitations

- Data lives in a single browser. Clearing browsing data, using a private window, or switching to another device or browser means starting with no data.
- Only one officer can use the app at a time. There are no user accounts or sync.
- If the app is open in two tabs at once, the last tab to save overwrites the other's changes.
