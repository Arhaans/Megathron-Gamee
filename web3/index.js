// server/index.js
import express   from 'express';
import cors      from 'cors';
import dotenv    from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  PublicKey
} from '@solana/web3.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

const secretKeyArray = JSON.parse(
  Buffer.from(process.env.ESCROW_SECRET_KEY_BASE64, 'base64').toString('utf8')
);

const escrow = Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
const ESCROW_PUBKEY = new PublicKey(process.env.ESCROW_PUBLIC_KEY);

app.get('/api/hasJoined', async (req, res) => {
  const { publicKey } = req.query;
  if (!publicKey) {
    return res
      .status(400)
      .json({ error: 'Missing required query parameter: publicKey' });
  }

  try {
    const { data, error } = await sb
      .from('players')
      .select('public_key')
      .eq('public_key', publicKey)
      .limit(1);

    if (error) throw error;
    res.json({ joined: data.length > 0 });
  } catch (err) {
    console.error('hasJoined error', err);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/join', async (req, res) => {
  const { publicKey, txSig } = req.body;

  if (!publicKey || !txSig) {
    return res
      .status(400)
      .json({ error: 'Missing publicKey or txSig in request body' });
  }

  try {
    const { error } = await sb
      .from('players')
      .insert({
        public_key: publicKey,
        join_tx_sig: txSig
      });

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('join error', err);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/payout', async (req, res) => {
  const { publicKey } = req.body;

  if (!publicKey) {
    return res
      .status(400)
      .json({ error: 'Missing publicKey in request body' });
  }

  try {
    // 1) Check escrow balance
    const balance = await conn.getBalance(escrow.publicKey);
    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      throw new Error('Insufficient escrow funds');
    }

    // 2) Transfer 1.5 SOL back to the winner
    const ix = SystemProgram.transfer({
      fromPubkey: escrow.publicKey,
      toPubkey: new PublicKey(publicKey),
      lamports: 0.1 * LAMPORTS_PER_SOL
    });
    const tx = new Transaction().add(ix);
    const signature = await conn.sendTransaction(tx, [escrow]);
    await conn.confirmTransaction(signature, 'confirmed');

    // 3) Record the payout in Supabase
    const { error } = await sb.from('payouts').insert({
      public_key: publicKey,
      amount_sol: 0.1,
      payout_tx: signature
    });
    if (error) throw error;

    res.json({ success: true, sig: signature });
  } catch (err) {
    console.error('payout error', err);
    res.status(500).json({ error: err.message });
  }
});


// Start server
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(
    `Tournament server listening at http://localhost:${port}`
  );
});
