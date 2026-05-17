# CUNY Housing Finder

CUNY Housing Finder is a student-focused web application that helps CUNY students find rooms and housing options near CUNY campuses. The project provides an interactive map, student-submitted listings, campus-based filtering, and local or cloud-based listing storage.

## Live Demo

[View Live Project](https://maharabh68-stack.github.io/CUNY-HOUSING-FINDER/)

## Project Overview

Finding affordable housing near campus can be difficult for students, especially in New York City. CUNY Housing Finder was built to make that process easier by allowing students to search for nearby housing, post room listings, and filter results based on campus, price, and listing type.

This project is a front-end web application built with HTML, CSS, and JavaScript. It uses Leaflet.js and OpenStreetMap for the interactive map, with optional Supabase support for cloud storage.

## Features

- Interactive map centered around New York City
- CUNY campus pins displayed on the map
- Student-submitted housing listings
- Add listings for students who need a room
- Add listings for rooms that are available
- Search listings by keyword
- Filter listings by type, campus, and price range
- “My listings only” option
- Sort listings by newest, price low to high, or price high to low
- Locate Me feature with 1 km, 3 km, and 5 km radius options
- Listing summary counters for total, available, need room, and campuses
- Local storage mode for testing
- Supabase cloud storage option
- Copy contact feature
- Delete option for listings created by the user
- Responsive dark-themed user interface
- Empty-state messages when no listings match the filters
- Basic validation for required title and contact fields

## Tech Stack

- HTML
- CSS
- JavaScript
- Leaflet.js
- Leaflet MarkerCluster
- OpenStreetMap
- Supabase
- GitHub Pages

## Project Structure

```text
CUNY-HOUSING-FINDER/
│
├── index.html      # Main page structure
├── styles.css      # Styling and responsive UI design
├── app.js          # Map logic, listings, filters, storage, and geolocation
└── README.md       # Project documentation

How It Works
The app loads an interactive map centered around New York City.
CUNY campus locations are displayed as map pins.
Students can post housing listings with title, contact, price, campus, and location details.
Listings can be saved using Supabase cloud storage or local browser storage.
Users can search and filter listings by keyword, campus, listing type, and price range.
The Locate Me feature shows listings within a selected radius.
The Listings page displays housing posts with sorting and contact-copy options.
Supabase Setup

This project includes optional Supabase support for cloud-based listing storage. To use Supabase properly, create a listings table with fields such as:
id
type
campus
title
description
price
contact
lat
lng
created_at

Important: If this project uses a public Supabase anon key, Row Level Security policies should be configured correctly to protect the database.

Future Improvements
Add student login system
Add verified CUNY student posting
Add listing approval or moderation
Add image upload for rooms
Add borough and neighborhood filters
Add room type filters
Add saved/favorite listings
Add report listing option
Improve database security rules
Add mobile-first map improvements
Disclaimer

This project is a student-built demo application. It is not an official CUNY housing service. Users should verify all housing information before contacting anyone, making payments, or signing agreements.
