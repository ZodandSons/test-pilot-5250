**free
// ---------------------------------------------------------------
// CUSTINQ - Customer Inquiry
// Displays customer master information and credit status.
// ---------------------------------------------------------------
ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt:*nodebugio);

dcl-f CUSTINQD workstn indds(ind);
dcl-f CUSTMAST keyed usage(*input);

dcl-ds ind qualified;
  exit    ind pos(3);
  cancel  ind pos(12);
  errCust ind pos(50);
end-ds;

dcl-s done ind inz(*off);
dcl-s avail packed(11:2);

dow not done;
  exfmt CPROMPT;
  cmsg = *blanks;

  if ind.exit or ind.cancel;
    done = *on;
    iter;
  endif;

  chain ccust CUSTMAST;
  if not %found(CUSTMAST);
    cmsg = 'Customer ' + %char(ccust) + ' not found.';
    ind.errCust = *on;
    iter;
  endif;

  avail = cmlimit - cmbal;
  if avail < 0;
    avail = 0;
  endif;

  select;
    when cmstat = 'A';
      cstatus = 'ACTIVE';
    when cmstat = 'H';
      cstatus = 'CREDIT HOLD';
    other;
      cstatus = 'UNKNOWN';
  endsl;

  cname  = cmname;
  ccity  = cmcity;
  climit = cmlimit;
  cbal   = cmbal;
  cavail = avail;
  exfmt CDETAIL;

  if ind.exit;
    done = *on;
  endif;
enddo;

*inlr = *on;
return;
