-- Two entry types whose seeded labels said something else than Home's rows (DESIGN.md rule 9:
-- the same thing looks and reads the same everywhere): the + sheet, the day list and the helper
-- said "Pumped" and "Medicine given" where Home says Pump and Medicine. Only a label still at its
-- old default changes; a home admin's own label (Entry types) is kept. (Diaper is already Diaper.)
update public.care_entry_types set label = 'Pump' where id = 'lana.pump' and label = 'Pumped';
update public.care_entry_types set label = 'Medicine' where id = 'lana.medication' and label = 'Medicine given';
