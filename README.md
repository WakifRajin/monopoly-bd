# 🎲 Bangladeshi Monopoly

A fully-featured, web-based Monopoly game with a distinct Bangladeshi flavor. Play locally with friends or online via real-time multiplayer rooms. Designed to be highly responsive, immersive, and playable across all devices.

[play now](https://wakifrajin.github.io/monopoly-bd/)

## ✨ Features

### 🎮 Gameplay Mechanics
- **Classic Monopoly Rules:** Buy properties, collect rent, build houses/hotels, mortgage assets, and avoid bankruptcy!
- **Auctions:** If a player declines to buy a property, it goes up for a competitive auction among all active players.
- **Trading System:** Propose and negotiate trades involving properties and money with other players.
- **Jail Mechanics:** Serve time, roll doubles, pay bail, or use a "Get Out of Jail Free" card.
- **Chance & Community Chest:** Fully implemented, randomized decks of cards that can change your fortune.
- **Custom Settings:** Set your preferred starting money (e.g., ৳15,000) and choose the maximum number of houses allowed per property (4 or 5).
- **Auto-Advance Timer:** Optional turn timer (10s to 60s) to keep the game moving quickly.

### 🌐 Multiplayer Modes
- **Local Pass & Play:** Play locally with friends on a single screen.
- **Online Multiplayer (Real-time):** 
  - Host or join live online rooms using a room code.
  - Set rooms to "Open" or "Closed" (password-protected).
  - Handles player disconnections smoothly, including automatic asset liquidation if a player abandons the match.
  - Built-in real-time chat system to talk to your opponents.

### 🗺️ Board Themes
Play on multiple uniquely designed boards:
- **🏙️ Dhaka City (Default):** Navigate the streets of the capital! Own properties from Mirpur Rd to Gulshan, and control utilities like DESA and WASA.
- **🇧🇩 Bangladesh:** Travel and buy across the nation, featuring major locations like Sylhet, Chittagong, Rajshahi, and Cox's Bazar.
- **🌍 World Tour:** A global board featuring iconic cities like Tokyo, Paris, London, and New York.
- **🏛️ Ancient Wonders:** Conquer empires of antiquity, including Babylon, Sparta, and Rome.

### 📱 UI & UX
- **Fully Responsive:** A polished 3-column layout for desktop screens, and an optimized bottom-bar/drawer interface for mobile devices.
- **Immersive Visuals:** Smooth dice rolling animations, floating player tokens, toast notifications, and celebratory confetti upon winning.
- **Live Game Log:** Keep track of every dice roll, rent payment, auction, and trade through a continuous game log.

## 🛠️ Technologies Used

This project is built as a highly optimized, lightweight Single-Page Application (SPA) contained primarily in one file.

- **HTML5:** Semantic structure and accessible layout elements.
- **CSS3:** Extensive use of CSS Custom Properties (variables), CSS Grid, Flexbox, Keyframe Animations, and Media Queries for a seamless mobile-first responsive experience.
- **Vanilla JavaScript (ES6+):** Pure JavaScript handles the complex game engine, state management, transaction logic, and dynamic DOM manipulation without relying on heavy frameworks like React or Vue.
- **Firebase Realtime Database (RTDB):** Powers the online multiplayer engine by syncing complex game states (dice rolls, properties, balances) across all connected clients with ultra-low latency.
- **Firebase Authentication:** Utilizes seamless anonymous sign-ins to generate player sessions for the online mode.
