import test from 'node:test';
import assert from 'node:assert/strict';
import {isQmentumFcMigrationVerified} from '../scripts/lib/qmentum-fc-migration-verification.js';

const validWithDestinationOnly={ready:true,counts:{qmentumSource:65,qmentumDestination:70,create:0,equivalent:65,destinationOnly:5,occurrenceSource:4,occurrenceEquivalent:4,conflicts:0}};

test('accepts full FA equivalence while preserving documents that exist only in FC',()=>{
 assert.equal(isQmentumFcMigrationVerified(validWithDestinationOnly),true);
});

test('rejects any source document not equivalent in FC',()=>{
 assert.equal(isQmentumFcMigrationVerified({...validWithDestinationOnly,counts:{...validWithDestinationOnly.counts,equivalent:64}}),false);
 assert.equal(isQmentumFcMigrationVerified({...validWithDestinationOnly,counts:{...validWithDestinationOnly.counts,occurrenceEquivalent:3}}),false);
 assert.equal(isQmentumFcMigrationVerified({...validWithDestinationOnly,counts:{...validWithDestinationOnly.counts,create:1}}),false);
 assert.equal(isQmentumFcMigrationVerified({...validWithDestinationOnly,ready:false}),false);
});
