# Printing on a real printer

Status: **COMPLETED** (2026-10-20). Before this, only PDF output had been verified.

## Check

`scripts/native-macos-printer-smoke.js` (`prepare-native-macos-smoke.py printer`)
passed 9 of 9. It sent one job, `Printer-check.md`, to the default printer, an HP
OfficeJet 3830 on the network, through the app's own dialog: one copy, Letter,
portrait, one-sided, all pages. The fax queue for the same device was listed but
not chosen. The job held the whole note and no app controls.

CUPS completed it as job 9, 13 seconds after it was sent.

## On paper

The writer checked the page. All of these printed correctly, on one page with
normal margins and no app controls:
- the heading levels;
- bold, italic, and the code span;
- the bulleted and numbered lists, and the quotation;
- curly quotes, the em dash, "Café, déjà vu, naïve, Ångström", and "東京".

## Not covered

- Page ranges, multiple copies, and two-sided printing on paper. Ranges are verified
  in PDF output.
