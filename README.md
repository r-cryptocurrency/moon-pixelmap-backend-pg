# MOONPLACE BACKEND POSTGRES VERSION

## Overview

## Setup

Setup your postgres user and then insert values into .env file. There is example.env for help.

Create a table for master time-sorted smart contract list of events:

```
CREATE TABLE pixel_updates (
  id SERIAL PRIMARY KEY,
  block_number INTEGER,
  transaction_hash TEXT,
  pixel_block_uri TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
