d3.sankey = function() {
  var sankey = {},
      nodeWidth = 24,
      nodePadding = 8,
      size = [1, 1],
      nodes = [],
      links = [];

  sankey.nodeWidth = function(_) {
    if (!arguments.length) return nodeWidth;
    nodeWidth = +_;
    return sankey;
  };

  sankey.nodePadding = function(_) {
    if (!arguments.length) return nodePadding;
    nodePadding = +_;
    return sankey;
  };

  sankey.nodes = function(_) {
    if (!arguments.length) return nodes;
    nodes = _;
    return sankey;
  };

  sankey.links = function(_) {
    if (!arguments.length) return links;
    links = _;
    return sankey;
  };

  sankey.size = function(_) {
    if (!arguments.length) return size;
    size = _;
    return sankey;
  };

  sankey.layout = function(iterations) {
    computeNodeLinks();
    computeNodeValues();
    computeNodeBreadths();
    computeNodeDepths(iterations);
    computeLinkDepths();
    return sankey;
  };

  sankey.relayout = function() {
    computeLinkDepths();
    return sankey;
  };

  sankey.link = function() {
    var curvature = .5;

    function link(d) {
      var x0 = d.source.x + d.source.dx,
          x1 = d.target.x,
          xi = d3.interpolateNumber(x0, x1),
          x2 = xi(curvature),
          x3 = xi(1 - curvature),
          y0 = d.source.y + d.sy + d.dy / 2,
          y1 = d.target.y + d.ty + d.dy / 2;
      return "M" + x0 + "," + y0
           + "C" + x2 + "," + y0
           + " " + x3 + "," + y1
           + " " + x1 + "," + y1;
    }

    link.curvature = function(_) {
      if (!arguments.length) return curvature;
      curvature = +_;
      return link;
    };

    return link;
  };

  // Populate the sourceLinks and targetLinks for each node.
  // Also, if the source and target are not objects, assume they are indices.
  function computeNodeLinks() {
    nodes.forEach(function(node) {
      node.sourceLinks = [];
      node.targetLinks = [];
    });
    links.forEach(function(link) {
      var source = link.source,
          target = link.target;
      if (typeof source === "number") source = link.source = nodes[link.source];
      if (typeof target === "number") target = link.target = nodes[link.target];
      source.sourceLinks.push(link);
      target.targetLinks.push(link);
    });
  }

  // Compute the value (size) of each node by summing the associated links.
  function computeNodeValues() {
    nodes.forEach(function(node) {
      node.value = Math.max(
        d3.sum(node.sourceLinks, value),
        d3.sum(node.targetLinks, value)
      );
    });
  }

  // Iteratively assign the breadth (x-position) for each node.
  // Nodes are assigned the maximum breadth of incoming neighbors plus one;
  // nodes with no incoming links are assigned breadth zero, while
  // nodes with no outgoing links are assigned the maximum breadth.
  function computeNodeBreadths() {
    var remainingNodes = nodes,
        nextNodes,
        x = 0;

    while (remainingNodes.length) {
      nextNodes = [];
      remainingNodes.forEach(function(node) {
        node.x = x;
        node.dx = nodeWidth;
        node.sourceLinks.forEach(function(link) {
          nextNodes.push(link.target);
        });
      });
      remainingNodes = nextNodes;
      ++x;
    }

    //
    moveSinksRight(x);
    scaleNodeBreadths((width - nodeWidth) / (x - 1));
  }

  function moveSourcesRight() {
    nodes.forEach(function(node) {
      if (!node.targetLinks.length) {
        node.x = d3.min(node.sourceLinks, function(d) { return d.target.x; }) - 1;
      }
    });
  }

  function moveSinksRight(x) {
    nodes.forEach(function(node) {
      if (!node.sourceLinks.length) {
        node.x = x - 1;
      }
    });
  }

  function scaleNodeBreadths(kx) {
    nodes.forEach(function(node) {
      node.x *= kx;
    });
  }

  function computeNodeDepths(iterations) {
    var nodesByBreadth = d3.nest()
        .key(function(d) { return d.x; })
        .sortKeys(d3.ascending)
        .entries(nodes)
        .map(function(d) { return d.values; });

    //
    initializeNodeDepth();
    resolveCollisions();
    for (var alpha = 1; iterations > 0; --iterations) {
      relaxRightToLeft(alpha *= .99);
      resolveCollisions();
      relaxLeftToRight(alpha);
      resolveCollisions();
    }

    function initializeNodeDepth() {
      var ky = d3.min(nodesByBreadth, function(nodes) {
        return (size[1] - (nodes.length - 1) * nodePadding) / d3.sum(nodes, value);
      });

      nodesByBreadth.forEach(function(nodes) {
        nodes.forEach(function(node, i) {
          node.y = i;
          node.dy = node.value * ky;
        });
      });

      links.forEach(function(link) {
        link.dy = link.value * ky;
      });
    }

    function relaxLeftToRight(alpha) {
      nodesByBreadth.forEach(function(nodes, breadth) {
        nodes.forEach(function(node) {
          if (node.targetLinks.length) {
            var y = d3.sum(node.targetLinks, weightedSource) / d3.sum(node.targetLinks, value);
            node.y += (y - center(node)) * alpha;
          }
        });
      });

      function weightedSource(link) {
        return center(link.source) * link.value;
      }
    }

    function relaxRightToLeft(alpha) {
      nodesByBreadth.slice().reverse().forEach(function(nodes) {
        nodes.forEach(function(node) {
          if (node.sourceLinks.length) {
            var y = d3.sum(node.sourceLinks, weightedTarget) / d3.sum(node.sourceLinks, value);
            node.y += (y - center(node)) * alpha;
          }
        });
      });

      function weightedTarget(link) {
        return center(link.target) * link.value;
      }
    }

    function resolveCollisions() {
      nodesByBreadth.forEach(function(nodes) {
        var node,
            dy,
            y0 = 0,
            n = nodes.length,
            i;

        // Push any overlapping nodes down.
        nodes.sort(ascendingDepth);
        for (i = 0; i < n; ++i) {
          node = nodes[i];
          dy = y0 - node.y;
          if (dy > 0) node.y += dy;
          y0 = node.y + node.dy + nodePadding;
        }

        // If the bottommost node goes outside the bounds, push it back up.
        dy = y0 - nodePadding - size[1];
        if (dy > 0) {
          y0 = node.y -= dy;

          // Push any overlapping nodes back up.
          for (i = n - 2; i >= 0; --i) {
            node = nodes[i];
            dy = node.y + node.dy + nodePadding - y0;
            if (dy > 0) node.y -= dy;
            y0 = node.y;
          }
        }
      });
    }

    function ascendingDepth(a, b) {
      return a.y - b.y;
    }
  }

  function computeLinkDepths() {
    nodes.forEach(function(node) {
      node.sourceLinks.sort(ascendingTargetDepth);
      node.targetLinks.sort(ascendingSourceDepth);
    });
    nodes.forEach(function(node) {
      var sy = 0, ty = 0;
      node.sourceLinks.forEach(function(link) {
        link.sy = sy;
        sy += link.dy;
      });
      node.targetLinks.forEach(function(link) {
        link.ty = ty;
        ty += link.dy;
      });
    });

    function ascendingSourceDepth(a, b) {
      return a.source.y - b.source.y;
    }

    function ascendingTargetDepth(a, b) {
      return a.target.y - b.target.y;
    }
  }

  function center(node) {
    return node.y + node.dy / 2;
  }

  function value(link) {
    return link.value;
  }

  return sankey;
};


var units = "Checkins";

var margin = {top: 10, right: 10, bottom: 10, left: 20},
    width = 1000 - margin.left - margin.right,
    height = 650 - margin.top - margin.bottom;

var formatNumber = d3.format(",.0f"),    // zero decimal places
    format = function(d) { return formatNumber(d) + " " + units; },
    color = d3.scale.category20();


function makeGraph(graph, id, w, h){
  width = w - margin.left - margin.right;
  height = h - margin.top - margin.bottom;
  // append the svg canvas to the page
  var svg = d3.select(id).append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", 
            "translate(" + margin.left + "," + margin.top + ")");

  // Set the sankey diagram properties
  var sankey = d3.sankey()
      .nodeWidth(36)
      .nodePadding(15)
      .size([width, height]);

  var path = sankey.link();
  // load the data
    sankey
        .nodes(graph.nodes)
        .links(graph.links)
        .layout(32);

  // add in the links
    var link = svg.append("g").selectAll(".link")
        .data(graph.links)
      .enter().append("path")
        .attr("class", "link")
        .attr("d", path)
        .style("stroke-width", function(d) { return Math.max(1, d.dy); })
        .sort(function(a, b) { return b.dy - a.dy; });

  // add the link titles
    link.append("title")
          .text(function(d) {
          return d.source.name + " → " + 
                  d.target.name + "\n" + format(d.value); });

  // add in the nodes
    var node = svg.append("g").selectAll(".node")
        .data(graph.nodes)
      .enter().append("g")
        .attr("class", "node")
        .attr("transform", function(d) { 
        return "translate(" + d.x + "," + d.y + ")"; })
      .call(d3.behavior.drag()
        .origin(function(d) { return d; })
        .on("dragstart", function() { 
        this.parentNode.appendChild(this); })
        .on("drag", dragmove));

  // add the rectangles for the nodes
    node.append("rect")
        .attr("height", function(d) { return d.dy; })
        .attr("width", sankey.nodeWidth())
        .style("fill", function(d) { 
        return d.color = color(d.name.replace(/ .*/, "")); })
        .style("stroke", function(d) { 
        return d3.rgb(d.color).darker(2); })
      .append("title")
        .text(function(d) { 
        return d.name + "\n" + format(d.value); });

  // add in the title for the nodes
    node.append("text")
        .attr("x", -6)
        .attr("y", function(d) { return d.dy / 2; })
        .attr("dy", ".35em")
        .attr("text-anchor", "end")
        .attr("transform", null)
        .text(function(d) { return d.name; })
      .filter(function(d) { return d.x < width / 2; })
        .attr("x", 6 + sankey.nodeWidth())
        .attr("text-anchor", "start");

  // the function for moving the nodes
    function dragmove(d) {
      d3.select(this).attr("transform", 
          "translate(" + d.x + "," + (
                  d.y = Math.max(0, Math.min(height - d.dy, d3.event.y))
              ) + ")");
      sankey.relayout();
      link.attr("d", path);
    }
}


var data1 = {"nodes":[{"node":0,"name":"Sunday"},{"node":1,"name":"Monday"},{"node":2,"name":"Tuesday"},{"node":3,"name":"Wednesday"},{"node":4,"name":"Thursday"},{"node":5,"name":"Friday"},{"node":6,"name":"Saturday"},{"node":7,"name":"Nightlife"},{"node":8,"name":"Bars"},{"node":9,"name":"American (New)"},{"node":10,"name":"Coffee & Tea"},{"node":11,"name":"American (Traditional)"},{"node":12,"name":"Sandwiches"},{"node":13,"name":"Breakfast & Brunch"},{"node":14,"name":"Pizza"},{"node":15,"name":"Grocery"},{"node":16,"name":"Pubs"},{"node":17,"name":"Italian"},{"node":18,"name":"Mexican"},{"node":19,"name":"Burgers"},{"node":20,"name":"Specialty Food"},{"node":21,"name":"Seafood"}],"links":[{"source":7,"target":0,"value":3281},{"source":7,"target":1,"value":3870},{"source":7,"target":2,"value":4305},{"source":7,"target":3,"value":4625},{"source":7,"target":4,"value":7316},{"source":7,"target":5,"value":9015},{"source":7,"target":6,"value":4501},{"source":8,"target":0,"value":3233},{"source":8,"target":1,"value":3825},{"source":8,"target":2,"value":4246},{"source":8,"target":3,"value":4521},{"source":8,"target":4,"value":7191},{"source":8,"target":5,"value":8850},{"source":8,"target":6,"value":4405},{"source":9,"target":0,"value":2099},{"source":9,"target":1,"value":2428},{"source":9,"target":2,"value":2736},{"source":9,"target":3,"value":2826},{"source":9,"target":4,"value":4065},{"source":9,"target":5,"value":4598},{"source":9,"target":6,"value":2952},{"source":10,"target":0,"value":2419},{"source":10,"target":1,"value":2531},{"source":10,"target":2,"value":2491},{"source":10,"target":3,"value":2515},{"source":10,"target":4,"value":2721},{"source":10,"target":5,"value":3169},{"source":10,"target":6,"value":2418},{"source":11,"target":0,"value":1745},{"source":11,"target":1,"value":1949},{"source":11,"target":2,"value":2021},{"source":11,"target":3,"value":2125},{"source":11,"target":4,"value":3177},{"source":11,"target":5,"value":3871},{"source":11,"target":6,"value":2184},{"source":12,"target":0,"value":1158},{"source":12,"target":1,"value":1224},{"source":12,"target":2,"value":1259},{"source":12,"target":3,"value":1291},{"source":12,"target":4,"value":1536},{"source":12,"target":5,"value":1737},{"source":12,"target":6,"value":1259},{"source":13,"target":0,"value":886},{"source":13,"target":1,"value":825},{"source":13,"target":2,"value":793},{"source":13,"target":3,"value":823},{"source":13,"target":4,"value":1198},{"source":13,"target":5,"value":2176},{"source":13,"target":6,"value":2160},{"source":14,"target":0,"value":778},{"source":14,"target":1,"value":1027},{"source":14,"target":2,"value":1033},{"source":14,"target":3,"value":1185},{"source":14,"target":4,"value":1670},{"source":14,"target":5,"value":1918},{"source":14,"target":6,"value":984},{"source":15,"target":0,"value":1052},{"source":15,"target":1,"value":962},{"source":15,"target":2,"value":968},{"source":15,"target":3,"value":948},{"source":15,"target":4,"value":1041},{"source":15,"target":5,"value":1765},{"source":15,"target":6,"value":1566},{"source":16,"target":0,"value":732},{"source":16,"target":1,"value":917},{"source":16,"target":2,"value":954},{"source":16,"target":3,"value":950},{"source":16,"target":4,"value":1512},{"source":16,"target":5,"value":1911},{"source":16,"target":6,"value":1098},{"source":17,"target":0,"value":707},{"source":17,"target":1,"value":942},{"source":17,"target":2,"value":978},{"source":17,"target":3,"value":1022},{"source":17,"target":4,"value":1532},{"source":17,"target":5,"value":1842},{"source":17,"target":6,"value":913},{"source":18,"target":0,"value":869},{"source":18,"target":1,"value":974},{"source":18,"target":2,"value":984},{"source":18,"target":3,"value":988},{"source":18,"target":4,"value":1442},{"source":18,"target":5,"value":1442},{"source":18,"target":6,"value":857},{"source":19,"target":0,"value":664},{"source":19,"target":1,"value":725},{"source":19,"target":2,"value":766},{"source":19,"target":3,"value":751},{"source":19,"target":4,"value":993},{"source":19,"target":5,"value":1228},{"source":19,"target":6,"value":763},{"source":20,"target":0,"value":627},{"source":20,"target":1,"value":662},{"source":20,"target":2,"value":614},{"source":20,"target":3,"value":621},{"source":20,"target":4,"value":830},{"source":20,"target":5,"value":1637},{"source":20,"target":6,"value":871},{"source":21,"target":0,"value":522},{"source":21,"target":1,"value":614},{"source":21,"target":2,"value":635},{"source":21,"target":3,"value":674},{"source":21,"target":4,"value":1022},{"source":21,"target":5,"value":1383},{"source":21,"target":6,"value":738}]};
var data2 = {"nodes":[{"node":0,"name":"12am"},{"node":1,"name":"1am"},{"node":2,"name":"2am"},{"node":3,"name":"3am"},{"node":4,"name":"4am"},{"node":5,"name":"5am"},{"node":6,"name":"6am"},{"node":7,"name":"7am"},{"node":8,"name":"8am"},{"node":9,"name":"9am"},{"node":10,"name":"10am"},{"node":11,"name":"11am"},{"node":12,"name":"12pm"},{"node":13,"name":"1pm"},{"node":14,"name":"2pm"},{"node":15,"name":"3pm"},{"node":16,"name":"4pm"},{"node":17,"name":"5pm"},{"node":18,"name":"6pm"},{"node":19,"name":"7pm"},{"node":20,"name":"8pm"},{"node":21,"name":"9pm"},{"node":22,"name":"10pm"},{"node":23,"name":"11pm"},{"node":24,"name":"Nightlife"},{"node":25,"name":"Bars"},{"node":26,"name":"American (New)"},{"node":27,"name":"Coffee & Tea"},{"node":28,"name":"American (Traditional)"},{"node":29,"name":"Sandwiches"},{"node":30,"name":"Breakfast & Brunch"},{"node":31,"name":"Pizza"},{"node":32,"name":"Grocery"},{"node":33,"name":"Pubs"},{"node":34,"name":"Italian"},{"node":35,"name":"Mexican"},{"node":36,"name":"Burgers"},{"node":37,"name":"Specialty Food"},{"node":38,"name":"Seafood"}],"links":[{"source":24,"target":0,"value":35},{"source":24,"target":1,"value":17},{"source":24,"target":2,"value":12},{"source":24,"target":3,"value":17},{"source":24,"target":4,"value":57},{"source":24,"target":5,"value":68},{"source":24,"target":6,"value":116},{"source":24,"target":7,"value":285},{"source":24,"target":8,"value":1132},{"source":24,"target":9,"value":2096},{"source":24,"target":10,"value":1865},{"source":24,"target":11,"value":1491},{"source":24,"target":12,"value":1302},{"source":24,"target":13,"value":1694},{"source":24,"target":14,"value":3338},{"source":24,"target":15,"value":4496},{"source":24,"target":16,"value":4427},{"source":24,"target":17,"value":4129},{"source":24,"target":18,"value":3407},{"source":24,"target":19,"value":2744},{"source":24,"target":20,"value":2027},{"source":24,"target":21,"value":1374},{"source":24,"target":22,"value":630},{"source":24,"target":23,"value":154},{"source":25,"target":0,"value":34},{"source":25,"target":1,"value":17},{"source":25,"target":2,"value":12},{"source":25,"target":3,"value":17},{"source":25,"target":4,"value":55},{"source":25,"target":5,"value":64},{"source":25,"target":6,"value":113},{"source":25,"target":7,"value":283},{"source":25,"target":8,"value":1117},{"source":25,"target":9,"value":2053},{"source":25,"target":10,"value":1815},{"source":25,"target":11,"value":1464},{"source":25,"target":12,"value":1286},{"source":25,"target":13,"value":1661},{"source":25,"target":14,"value":3274},{"source":25,"target":15,"value":4413},{"source":25,"target":16,"value":4331},{"source":25,"target":17,"value":4031},{"source":25,"target":18,"value":3353},{"source":25,"target":19,"value":2712},{"source":25,"target":20,"value":2014},{"source":25,"target":21,"value":1368},{"source":25,"target":22,"value":630},{"source":25,"target":23,"value":154},{"source":26,"target":0,"value":8},{"source":26,"target":1,"value":6},{"source":26,"target":2,"value":14},{"source":26,"target":3,"value":36},{"source":26,"target":4,"value":103},{"source":26,"target":5,"value":183},{"source":26,"target":6,"value":277},{"source":26,"target":7,"value":477},{"source":26,"target":8,"value":1102},{"source":26,"target":9,"value":1814},{"source":26,"target":10,"value":1346},{"source":26,"target":11,"value":792},{"source":26,"target":12,"value":644},{"source":26,"target":13,"value":924},{"source":26,"target":14,"value":1987},{"source":26,"target":15,"value":2710},{"source":26,"target":16,"value":2790},{"source":26,"target":17,"value":2344},{"source":26,"target":18,"value":1766},{"source":26,"target":19,"value":1147},{"source":26,"target":20,"value":723},{"source":26,"target":21,"value":324},{"source":26,"target":22,"value":158},{"source":26,"target":23,"value":29},{"source":27,"target":0,"value":4},{"source":27,"target":1,"value":1},{"source":27,"target":2,"value":26},{"source":27,"target":3,"value":252},{"source":27,"target":4,"value":1268},{"source":27,"target":5,"value":1450},{"source":27,"target":6,"value":1852},{"source":27,"target":7,"value":1693},{"source":27,"target":8,"value":1608},{"source":27,"target":9,"value":1867},{"source":27,"target":10,"value":1529},{"source":27,"target":11,"value":1394},{"source":27,"target":12,"value":1244},{"source":27,"target":13,"value":991},{"source":27,"target":14,"value":757},{"source":27,"target":15,"value":655},{"source":27,"target":16,"value":567},{"source":27,"target":17,"value":466},{"source":27,"target":18,"value":336},{"source":27,"target":19,"value":150},{"source":27,"target":20,"value":84},{"source":27,"target":21,"value":46},{"source":27,"target":22,"value":17},{"source":27,"target":23,"value":7},{"source":28,"target":0,"value":12},{"source":28,"target":1,"value":13},{"source":28,"target":2,"value":7},{"source":28,"target":3,"value":14},{"source":28,"target":4,"value":42},{"source":28,"target":5,"value":113},{"source":28,"target":6,"value":153},{"source":28,"target":7,"value":299},{"source":28,"target":8,"value":868},{"source":28,"target":9,"value":1375},{"source":28,"target":10,"value":1100},{"source":28,"target":11,"value":857},{"source":28,"target":12,"value":680},{"source":28,"target":13,"value":781},{"source":28,"target":14,"value":1387},{"source":28,"target":15,"value":1962},{"source":28,"target":16,"value":1997},{"source":28,"target":17,"value":1812},{"source":28,"target":18,"value":1437},{"source":28,"target":19,"value":965},{"source":28,"target":20,"value":591},{"source":28,"target":21,"value":368},{"source":28,"target":22,"value":169},{"source":28,"target":23,"value":70},{"source":29,"target":0,"value":23},{"source":29,"target":1,"value":9},{"source":29,"target":2,"value":5},{"source":29,"target":3,"value":38},{"source":29,"target":4,"value":160},{"source":29,"target":5,"value":286},{"source":29,"target":6,"value":373},{"source":29,"target":7,"value":393},{"source":29,"target":8,"value":866},{"source":29,"target":9,"value":1594},{"source":29,"target":10,"value":1201},{"source":29,"target":11,"value":709},{"source":29,"target":12,"value":527},{"source":29,"target":13,"value":438},{"source":29,"target":14,"value":576},{"source":29,"target":15,"value":625},{"source":29,"target":16,"value":545},{"source":29,"target":17,"value":358},{"source":29,"target":18,"value":238},{"source":29,"target":19,"value":162},{"source":29,"target":20,"value":123},{"source":29,"target":21,"value":74},{"source":29,"target":22,"value":73},{"source":29,"target":23,"value":68},{"source":30,"target":0,"value":9},{"source":30,"target":1,"value":7},{"source":30,"target":2,"value":10},{"source":30,"target":3,"value":49},{"source":30,"target":4,"value":196},{"source":30,"target":5,"value":582},{"source":30,"target":6,"value":940},{"source":30,"target":7,"value":1329},{"source":30,"target":8,"value":1421},{"source":30,"target":9,"value":1346},{"source":30,"target":10,"value":962},{"source":30,"target":11,"value":452},{"source":30,"target":12,"value":150},{"source":30,"target":13,"value":138},{"source":30,"target":14,"value":153},{"source":30,"target":15,"value":213},{"source":30,"target":16,"value":212},{"source":30,"target":17,"value":223},{"source":30,"target":18,"value":151},{"source":30,"target":19,"value":111},{"source":30,"target":20,"value":63},{"source":30,"target":21,"value":56},{"source":30,"target":22,"value":47},{"source":30,"target":23,"value":41},{"source":31,"target":0,"value":9},{"source":31,"target":1,"value":1},{"source":31,"target":2,"value":6},{"source":31,"target":3,"value":6},{"source":31,"target":4,"value":9},{"source":31,"target":5,"value":19},{"source":31,"target":6,"value":39},{"source":31,"target":7,"value":68},{"source":31,"target":8,"value":357},{"source":31,"target":9,"value":771},{"source":31,"target":10,"value":631},{"source":31,"target":11,"value":420},{"source":31,"target":12,"value":358},{"source":31,"target":13,"value":445},{"source":31,"target":14,"value":820},{"source":31,"target":15,"value":1147},{"source":31,"target":16,"value":1094},{"source":31,"target":17,"value":895},{"source":31,"target":18,"value":604},{"source":31,"target":19,"value":373},{"source":31,"target":20,"value":234},{"source":31,"target":21,"value":158},{"source":31,"target":22,"value":96},{"source":31,"target":23,"value":35},{"source":32,"target":0,"value":3},{"source":32,"target":1,"value":3},{"source":32,"target":2,"value":4},{"source":32,"target":3,"value":33},{"source":32,"target":4,"value":83},{"source":32,"target":5,"value":196},{"source":32,"target":6,"value":307},{"source":32,"target":7,"value":444},{"source":32,"target":8,"value":677},{"source":32,"target":9,"value":1007},{"source":32,"target":10,"value":799},{"source":32,"target":11,"value":796},{"source":32,"target":12,"value":648},{"source":32,"target":13,"value":586},{"source":32,"target":14,"value":666},{"source":32,"target":15,"value":648},{"source":32,"target":16,"value":517},{"source":32,"target":17,"value":428},{"source":32,"target":18,"value":217},{"source":32,"target":19,"value":128},{"source":32,"target":20,"value":70},{"source":32,"target":21,"value":28},{"source":32,"target":22,"value":9},{"source":32,"target":23,"value":5},{"source":33,"target":0,"value":4},{"source":33,"target":1,"value":1},{"source":33,"target":2,"value":5},{"source":33,"target":3,"value":2},{"source":33,"target":4,"value":16},{"source":33,"target":5,"value":24},{"source":33,"target":6,"value":39},{"source":33,"target":7,"value":64},{"source":33,"target":8,"value":209},{"source":33,"target":9,"value":377},{"source":33,"target":10,"value":383},{"source":33,"target":11,"value":319},{"source":33,"target":12,"value":338},{"source":33,"target":13,"value":408},{"source":33,"target":14,"value":789},{"source":33,"target":15,"value":1084},{"source":33,"target":16,"value":1028},{"source":33,"target":17,"value":966},{"source":33,"target":18,"value":796},{"source":33,"target":19,"value":535},{"source":33,"target":20,"value":325},{"source":33,"target":21,"value":220},{"source":33,"target":22,"value":114},{"source":33,"target":23,"value":28},{"source":34,"target":0,"value":6},{"source":34,"target":1,"value":2},{"source":34,"target":2,"value":6},{"source":34,"target":3,"value":7},{"source":34,"target":4,"value":26},{"source":34,"target":5,"value":33},{"source":34,"target":6,"value":65},{"source":34,"target":7,"value":92},{"source":34,"target":8,"value":400},{"source":34,"target":9,"value":828},{"source":34,"target":10,"value":628},{"source":34,"target":11,"value":341},{"source":34,"target":12,"value":278},{"source":34,"target":13,"value":316},{"source":34,"target":14,"value":735},{"source":34,"target":15,"value":1125},{"source":34,"target":16,"value":1135},{"source":34,"target":17,"value":837},{"source":34,"target":18,"value":518},{"source":34,"target":19,"value":291},{"source":34,"target":20,"value":171},{"source":34,"target":21,"value":52},{"source":34,"target":22,"value":29},{"source":34,"target":23,"value":15},{"source":35,"target":0,"value":2},{"source":35,"target":1,"value":4},{"source":35,"target":2,"value":2},{"source":35,"target":3,"value":10},{"source":35,"target":4,"value":6},{"source":35,"target":5,"value":13},{"source":35,"target":6,"value":21},{"source":35,"target":7,"value":34},{"source":35,"target":8,"value":494},{"source":35,"target":9,"value":785},{"source":35,"target":10,"value":589},{"source":35,"target":11,"value":403},{"source":35,"target":12,"value":288},{"source":35,"target":13,"value":399},{"source":35,"target":14,"value":670},{"source":35,"target":15,"value":1014},{"source":35,"target":16,"value":929},{"source":35,"target":17,"value":722},{"source":35,"target":18,"value":486},{"source":35,"target":19,"value":330},{"source":35,"target":20,"value":203},{"source":35,"target":21,"value":103},{"source":35,"target":22,"value":45},{"source":35,"target":23,"value":4},{"source":36,"target":0,"value":3},{"source":36,"target":1,"value":3},{"source":36,"target":2,"value":6},{"source":36,"target":3,"value":11},{"source":36,"target":4,"value":23},{"source":36,"target":5,"value":33},{"source":36,"target":6,"value":60},{"source":36,"target":7,"value":78},{"source":36,"target":8,"value":292},{"source":36,"target":9,"value":693},{"source":36,"target":10,"value":467},{"source":36,"target":11,"value":332},{"source":36,"target":12,"value":288},{"source":36,"target":13,"value":321},{"source":36,"target":14,"value":500},{"source":36,"target":15,"value":633},{"source":36,"target":16,"value":685},{"source":36,"target":17,"value":570},{"source":36,"target":18,"value":418},{"source":36,"target":19,"value":249},{"source":36,"target":20,"value":124},{"source":36,"target":21,"value":61},{"source":36,"target":22,"value":29},{"source":36,"target":23,"value":11},{"source":37,"target":0,"value":2},{"source":37,"target":1,"value":1},{"source":37,"target":2,"value":6},{"source":37,"target":3,"value":45},{"source":37,"target":4,"value":54},{"source":37,"target":5,"value":98},{"source":37,"target":6,"value":172},{"source":37,"target":7,"value":360},{"source":37,"target":8,"value":671},{"source":37,"target":9,"value":1051},{"source":37,"target":10,"value":835},{"source":37,"target":11,"value":660},{"source":37,"target":12,"value":510},{"source":37,"target":13,"value":360},{"source":37,"target":14,"value":346},{"source":37,"target":15,"value":250},{"source":37,"target":16,"value":231},{"source":37,"target":17,"value":105},{"source":37,"target":18,"value":66},{"source":37,"target":19,"value":16},{"source":37,"target":20,"value":10},{"source":37,"target":21,"value":7},{"source":37,"target":22,"value":5},{"source":37,"target":23,"value":1},{"source":38,"target":0,"value":5},{"source":38,"target":1,"value":1},{"source":38,"target":2,"value":2},{"source":38,"target":3,"value":4},{"source":38,"target":4,"value":6},{"source":38,"target":5,"value":14},{"source":38,"target":6,"value":36},{"source":38,"target":7,"value":83},{"source":38,"target":8,"value":386},{"source":38,"target":9,"value":694},{"source":38,"target":10,"value":511},{"source":38,"target":11,"value":411},{"source":38,"target":12,"value":307},{"source":38,"target":13,"value":259},{"source":38,"target":14,"value":438},{"source":38,"target":15,"value":705},{"source":38,"target":16,"value":719},{"source":38,"target":17,"value":544},{"source":38,"target":18,"value":262},{"source":38,"target":19,"value":128},{"source":38,"target":20,"value":34},{"source":38,"target":21,"value":26},{"source":38,"target":22,"value":9},{"source":38,"target":23,"value":4}]};
makeGraph(data1, "#chart1", 1100, 650);
makeGraph(data2, "#chart2", 1100, 1000);