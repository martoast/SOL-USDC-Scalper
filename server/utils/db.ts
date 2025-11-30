import fs from 'node:fs'
import path from 'node:path'

// Define the structure of our Trade
export interface Trade {
  id: string;
  address: string; // Crucial for tracking
  symbol: string;
  name: string;
  logoURI?: string;
  entryPrice: number;
  amount: number;
  timestamp: number;
  status: 'OPEN' | 'CLOSED';

  // Fee Tracking (for devnet simulation)
  entryFees?: number;      // Fees paid when opening position
  exitFees?: number;       // Fees paid when closing position
  totalFees?: number;      // Total fees paid (entry + exit)

  // Live Data (Not saved to DB, but useful type definition)
  currentPrice?: number;
  currentValue?: number;
  pnlPercent?: number;

  // Exit Data (Saved when closed)
  exitPrice?: number;
  pnl?: number;
  closedAt?: number;
}

// Define the DB Structure
interface Database {
  activeTrades: Trade[];
  history: Trade[];
}

// File Path (Saved in the root of your project)
const DB_DIR = path.resolve(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'trades.json')

// Ensure file and directory exist
const initDb = () => {
  try {
    // 1. Ensure Directory Exists
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true })
      console.log('📁 Created data directory')
    }

    // 2. Ensure JSON File Exists
    if (!fs.existsSync(DB_PATH)) {
      const initialData: Database = { activeTrades: [], history: [] }
      fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2))
      console.log('📄 Created trades.json database')
    }
  } catch (e) {
    console.error('❌ Failed to initialize database:', e)
  }
}

// Read Data (Safe Read)
export const getDb = (): Database => {
  initDb() // Always ensure it exists before reading
  
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8')
    
    // Handle empty file case
    if (!data.trim()) {
      return { activeTrades: [], history: [] }
    }
    
    return JSON.parse(data)
  } catch (e) {
    console.error("⚠️ Database corruption or read error. Returning empty state.", e)
    // Fallback to empty state so app doesn't crash
    return { activeTrades: [], history: [] }
  }
}

// Write Data (Safe Write)
export const saveDb = (data: Database) => {
  try {
    initDb() // Ensure folder exists before writing
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error("❌ Failed to save database:", e)
  }
}