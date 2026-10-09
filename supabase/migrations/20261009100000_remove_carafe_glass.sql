-- Troy, 9 Oct 2026: "carafe" is always "jug". The Carafe glass option is removed (Jug already exists); the two drinks that used it now use Jug.
delete from public.cost_bar_options where kind = 'glass' and name = 'Carafe';
