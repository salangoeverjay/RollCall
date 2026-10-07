# RollCall: Prompt Log

This file records each prompt given while building RollCall and what came of it.

---

## Prompt 1: Initial build

> Build "RollCall", a Student Organization Event and Attendance Manager, using only plain HTML, CSS, and vanilla JavaScript. No frameworks, no libraries, no backend. Users are organization officers.
>
> **FILES**
> - index.html: layout and sections
> - style.css: clean, minimal, responsive styling
> - app.js: all logic
> - Save all data in localStorage so it stays after a page refresh. Load sample data on first run.
>
> **DATA**
> - Event: id, name, date, venue, capacity (number, min 1), status ("Draft" | "Open" | "Closed" | "Completed", default "Draft")
> - Registration: id, eventId, studentName, studentId, yearLevel (1-5), dateRegistered, present (true/false, default false)
>
> **BUSINESS RULES** (check these in the JavaScript functions, not just by hiding buttons)
> 1. Add, edit, and delete events. Status moves only in this order: Draft → Open for Registration → Closed → Completed. Do not allow skipping or going backward.
> 2. Students can register only when the event status is Open.
> 3. Registration works only while the registered count is below capacity. When full, show "This event is full" and do not register.
> 4. The same student ID cannot register twice for the same event. Show a clear message.
> 5. Cancelling a registration removes it and frees a slot.
> 6. Check-in: allowed only on the event's date (event date == today), and only for students registered for that event. An unregistered student ID shows "Student is not registered for this event." Officers can undo Present.
> 7. An event that has registrations cannot be deleted. Show "Set this event to Completed instead."
> 8. For each event, compute: registered, slots left (capacity - registered), present, and attendance rate = present ÷ registered × 100, rounded to 1 decimal. Show 0% when registered is 0. Always compute these from the data. Never store them.
>
> **SCREENS** (single page with tabs or sections)
> - Events list: table with name, date, venue, status badge, registered, slots left, present, and attendance rate. Counts update live after every action. Include a filter by status.
> - Event details (opens when an event is clicked): event info and counts, a registration form, and a registrations table with search by name or student ID, a filter by attendance (All / Present / Absent), a Cancel button, and a Check-in / Undo Present toggle.
> - Report: number of events per status, and the Completed event with the highest attendance rate. Show "No completed events yet" if there are none.
>
> **QUALITY**
> - Validate all form inputs (required fields, capacity at least 1, year level 1-5).
> - Show success and error messages for every action.
> - Sample data: at least one event in each status, one full event, and one event dated today so check-in can be tested.
> - Keep the code organized with small, clearly named functions and comments for each business rule.
>
> **GIT**
> - Build everything except check-in and attendance rate on the main branch first.
> - Then create a branch named feature/check-in-attendance-rate containing only the check-in/undo logic, the today-only and must-be-registered rules, and the present count and attendance rate computation and display.
> - Write a pull request description for that branch summarizing the changes and how to test them.
>
> SKILLS
> * Use a front-end

**Result:** Git was not installed on the machine. The build was interrupted before any files were written.

---

## Prompt 2: Drop the Git steps

> from earlier prompt exclude the GIT i'll do it manually

**Result:** Built the complete app (`index.html`, `style.css`, `app.js`) with the check-in feature included.
- All 8 business rules are enforced in the data functions (`createEvent`, `registerStudent`, `checkInStudent`, and so on). Each returns `{ ok, message }`, and the UI shows that message.
- Sample data had one event per status, one full event, and one event dated today.
- Every rule was tested in the browser and returned the expected message.
- Choices the spec did not cover:
  - Undo Present also only works on the event's date.
  - Registrations on Completed events cannot be cancelled. This stops anyone from cancelling every registration and then deleting the event, which rule 7 forbids.
  - Capacity cannot be edited below the number of students already registered.
- For the manual Git split, the code that belongs on `feature/check-in-attendance-rate` was listed.

---

## Prompt 3: Remove test events

> (Screenshots of the Report and Events screens showing "HATDOG" test events.) remove those event make sure its fresh

**Result:** Cleared the browser storage in the preview. The app went back to the 6 sample events.

---

## Prompt 4

> still in there

**Result:** The HATDOG events were in the user's own browser, which the preview could not clear. Two changes fixed it:
- New storage names, so the old data is ignored and deleted when the page loads.
- A "Reset to sample data" button on the Report tab.

---

## Prompt 5: Start empty

> I mean remove the static events and report

**Result:** Removed the sample data completely, so the app now starts empty.
- The "Reset" button became **"Clear all data"**.
- Storage names were changed again so every browser starts fresh.
- On first load, the Events list shows "No events yet" and the Report shows zeros with "No completed events yet".
- This goes against the original spec, which asked for sample data on first run.

---

## Prompt 6: Recommendations

> what can you recommend about this app to improve

**Result:** 15 suggestions in five groups: data safety, event-day speed, gaps in the rules, quality of life, and code health. The top three were JSON backup and import, CSV export of attendance, and a "Load demo data" button.

---

## Prompt 7: CSV export

> add csv export of the attendance list

**Result:** Added an **Export CSV** button to each event's Registrations section.
- File name: `<event-name>-<date>-attendance.csv`
- Columns: Student Name, Student ID, Year Level, Date Registered, Attendance
- Exports every registration, ignoring the search box and attendance filter.
- Excel shows accented names such as "José" correctly.
- A name starting with `=`, `+`, `-` or `@` is saved as text, so a spreadsheet won't run it as a formula.
- Shows "No registrations to export yet." when the event has no registrations.

---

## Prompt 8: Modern UI

> make the UI modern and user friendly

**Result:** Redesigned the whole interface. The business rules were unchanged and still passed every check afterwards.
- **Look:** header that stays at the top when scrolling, indigo accent, rounded cards, coloured status badges, and automatic dark mode.
- **Events list:**
  - Summary cards (total, open, today, upcoming).
  - Status filter buttons with counts, and a search box for names and venues.
  - A "Today" badge, a progress bar for how full each event is (red when full), and an attendance-rate bar.
- **Event page:**
  - A progress bar for the Draft → Open → Closed → Completed steps.
  - Stat cards with meters, and the Register and Check-in forms side by side.
  - Coloured initials for each student.
- **Report:** a colour bar of events per status, and a circular gauge for the top Completed event.
- **Phones:** tables turn into stacked cards, with no sideways scrolling.
- **Easier to use:**
  - The cursor goes straight to the Check-in box on event day, which works with ID scanners.
  - After registering a student, the cursor returns to the name field.
  - Forms that can't be used are greyed out with the reason shown.
  - The empty Events list shows a "Create event" button.
  - Messages have an icon and a close button.
- Checked at desktop, tablet and phone widths with no console errors.

---

## Prompt 9

> add my prompt in this conversation and the result to prompt.md

**Result:** Created this file.
