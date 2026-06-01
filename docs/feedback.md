# Arduino Lab for MicroPython Feedback

# Things I love about Arduino Lab for MicroPython

**In the Editor**

- The UI/UX feels much more polished than Thonny, and more accessible to new users than VS Code  
- I like that it's simple, and that complexity is revealed only when its needed \- nice design principle  
- The console colour highlighting is great, really helps when writing code and debugging  
- I like the big buttons, larger buttons are easy to click\!  
- The Clear terminal button (the trashcan) is so useful\!\!

**In the Files screen**

- I love that some options appear when they are relevant (like selecting a file makes the rename, delete, open, download options appear)  
- The icons for the board and computer are a nice touch

**Package Installer**

- I like this, the installer is straightforward; the search is essential too\!  
- I like the convert files to .mpy to optimize speed and size \- really nice  
- I also like the overwriting option and custom url, in the Advanced options too

# ---

# Bugs / Annoyances

**General**  
The Editor/Files switching breaks the flow of developing \- one of the things I like about Thonny is that you can immediately right click to upload a file to the board

- there is no right click menu \- would be useful for file related activities (rename, delete, upload, download, new folder, new file)  
- switching breaks between Editor/Files breaks the flow of developing; I’d prefer a pane that can be opened/collapsed when working with files as its a common activity when developing with micropython

**Add Package**  
`Add Package` is very prominent, but how often is that used per session? I’d prefer a big Help button for help on using the app, and maybe MicroPython language syntax.

Clicking on `Add Package` kicks you out to another app; I like to stay within the app when working on code, this breaks the flow somewhat.

**The Editor**  
Autocomplete is missing some key MicroPython suggestions (such as \`import machine\` doesn’t get suggested as I type).

Creating new files could be easier if the tab had a `+` button (this is in addition to the `New` button on the toolbar), I noticed I went to click a new tab button but it wasn’t there (probably VS Code muscle memory)

When opening the app the terminal/console is always minimized \- given this a MicroPython editing tool, I would have expected this to be open by default (as its rare this would be ever closed)

Clicking the file selection tickboxes on MacOS is tricky because the scroll bar appears when you try to select a checkbox and there is a slight overlap:  
![][image1]  
The icon for uploading to the board points upwards, but the board folder listing is to the left of the computer folder listing, so this isn’t intuitive (I had to hunt for this). It would be more intuitive to have the upload and download buttons between the two folder panes.

![][image2]

**Help menu**  
There isn’t much Help available \- the help menu `Learn more` takes you to the github page, rather than some nice in app documentation or learning materials.

# Features I’d love to see

I would use this over VS code if it could also:

- Integrate `Git` source code control  
- Upload/Upgrade MicroPython firmware (not via a separate app)  
- Serial Plotter using data from console output \- Like Arduino IDE  
- AI Chat integration \- either the Arduino AI Assistant or Claude Code etc  
- AI driven auto complete  
- Integration with Arduino Cloud for loading/saving files, creating Things, cloud variables etc  
- The MicroPython Package installer would be even better if it showed the top 10 most downloaded packages \- as a discovery feature, this could either be via an Arduino curated list or via PyPi ([https://pypistats.org/top](https://pypistats.org/top))  
- Does it detect the version is out of date and update automatically (like VS Code?) that would be neat

One last bit:

the core of this application is [`micropython.js`](http://micropython.js)  
we plan on reusing it for anything micropython, and the long term plan is to take what we learned from this LAB experiment and bring it to future implementations of tools

really enjoyed the feedback, your opinion is very valuable to me 🙂  
thank you  
u.
