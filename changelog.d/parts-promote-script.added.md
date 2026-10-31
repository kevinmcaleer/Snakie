- **`npm run parts:promote` brings kevsrobots.com catalog parts into the
  Standard library.** The Standard library is the master copy of the parts
  catalog, and the site imports it. Parts made on the site never came back;
  this script lists the ones the library is missing (and site duplicates of
  library parts) and with `--write` copies them in, photo and mesh included,
  for review.
