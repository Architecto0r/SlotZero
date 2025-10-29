# SlotZero
Describes the problem of fork choice and finality in Ethereum PoS, the relevance of Single Slot Finality (SSF) as a possible improvement to network finality, and demonstrates a working prototype—SlotZero.

<img width="1897" height="783" alt="1" src="https://github.com/user-attachments/assets/db4b47f4-f04b-4ec7-856e-0977d010371f" />

<img width="1897" height="650" alt="2" src="https://github.com/user-attachments/assets/2ee5aa0a-3653-46e1-8f8d-632c807a06bb" />

<img width="1901" height="600" alt="3" src="https://github.com/user-attachments/assets/d0fb2c0e-5722-4715-8313-35b9bd1ad1d6" />

________________________________________________________________________________________________________________________________
https://docsend.com/v/f4zp9/slotzero
________________________________________________________________________________________________________________________________
10.30.2025 V0.2

Features:
 - slots & epochs
- delayed vote delivery (simulated network latency)
 - LMD-GHOST head selection using validators' latest messages
 - Single Slot Finality (SSF): block may be finalized in the same slot if quorum reached
- fork attacks simulation, metrics endpoint
  +server2.py app.js (update)
________________________________________________________________________________________________________________________________
<img width="1891" height="731" alt="Снимок экрана 2025-10-30 033919" src="https://github.com/user-attachments/assets/32664fad-c6e5-4db7-ae31-19a77e26e5cd" />

<img width="1886" height="1027" alt="Снимок экрана 2025-10-30 033930" src="https://github.com/user-attachments/assets/51d4b23d-8a32-4f53-ab9b-2d2326d08da9" />



