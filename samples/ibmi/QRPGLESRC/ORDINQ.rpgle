**free
// ---------------------------------------------------------------
// ORDINQ - Order Inquiry
// Prompts for a customer, lists the customer's orders in a
// subfile, displays order detail (option 5) and cancels open
// orders (option 4).
// ---------------------------------------------------------------
ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt:*nodebugio);

dcl-f ORDINQD workstn sfile(ORDSFL:rrn) indds(ind);
dcl-f CUSTMAST keyed usage(*input);
dcl-f ORDHDR keyed usage(*update);
dcl-f ORDHDRL1 keyed usage(*input) rename(ORDHDRR:ORDHDRR1) prefix(L1_);

dcl-ds ind qualified;
  exit      ind pos(3);
  cancel    ind pos(12);
  sflDsp    ind pos(31);
  sflDspCtl ind pos(32);
  sflClr    ind pos(33);
  sflEnd    ind pos(34);
  errCust   ind pos(50);
end-ds;

dcl-s rrn      packed(4:0);
dcl-s done     ind inz(*off);
dcl-s cnt      packed(5:0);

// ---- main line -------------------------------------------------
dow not done;
  exfmt PROMPT;
  msg = *blanks;
  ind.errCust = *off;

  if ind.exit or ind.cancel;
    done = *on;
    iter;
  endif;

  if custno = 0;
    msg = 'Customer number is required.';
    ind.errCust = *on;
    iter;
  endif;

  chain custno CUSTMAST;
  if not %found(CUSTMAST);
    msg = 'Customer ' + %char(custno) + ' not found.';
    ind.errCust = *on;
    iter;
  endif;

  if cmstat = 'H';
    msg = 'Customer is on credit hold. Contact credit dept.';
    ind.errCust = *on;
    iter;
  endif;

  loadOrders();
  showOrders();
enddo;

*inlr = *on;
return;

// ---- load the order subfile -----------------------------------
dcl-proc loadOrders;
  ind.sflClr = *on;
  write ORDCTL;
  ind.sflClr = *off;
  rrn = 0;
  cnt = 0;

  setll custno ORDHDRL1;
  reade custno ORDHDRL1;
  dow not %eof(ORDHDRL1);
    rrn += 1;
    cnt += 1;
    sordno = L1_ohordn;
    sdate  = L1_ohdate;
    samt   = L1_ohamt;
    sstat  = L1_ohstat;
    sopt   = *blanks;
    write ORDSFL;
    reade custno ORDHDRL1;
  enddo;

  ind.sflDsp = (rrn > 0);
  ind.sflDspCtl = *on;
  ind.sflEnd = *on;
end-proc;

// ---- display subfile and process options ----------------------
dcl-proc showOrders;
  dcl-s back ind inz(*off);

  dow not back;
    write FKEYS;
    exfmt ORDCTL;
    msg = *blanks;

    if ind.exit;
      done = *on;
      return;
    endif;

    if ind.cancel;
      back = *on;
      iter;
    endif;

    readc ORDSFL;
    dow not %eof(ORDINQD);
      select;
        when sopt = '5';
          showDetail(sordno);
        when sopt = '4';
          cancelOrder(sordno);
        when sopt <> ' ';
          msg = 'Option ' + sopt + ' is not valid.';
      endsl;
      sopt = *blanks;
      update ORDSFL;
      readc ORDSFL;
    enddo;
  enddo;
end-proc;

// ---- order detail ---------------------------------------------
dcl-proc showDetail;
  dcl-pi *n;
    ordno packed(7:0) const;
  end-pi;

  chain ordno ORDHDR;
  if %found(ORDHDR);
    dordno = ohordn;
    dcust  = custno;
    dname  = cmname;
    ddate  = ohdate;
    damt   = ohamt;
    dstat  = ohstat;
    exfmt DETAIL;
  endif;
end-proc;

// ---- cancel an open order -------------------------------------
dcl-proc cancelOrder;
  dcl-pi *n;
    ordno packed(7:0) const;
  end-pi;

  chain ordno ORDHDR;
  if not %found(ORDHDR);
    msg = 'Order not found.';
    return;
  endif;

  if ohstat <> 'OPEN';
    msg = 'Only OPEN orders can be cancelled.';
    unlock ORDHDR;
    return;
  endif;

  ohstat = 'CANCELLED';
  update ORDHDRR;
  sstat = ohstat;
  msg = 'Order ' + %char(ordno) + ' cancelled.';
end-proc;
