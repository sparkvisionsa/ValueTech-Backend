const Ad = require("../../infrastructure/models/Ad");

/**
 * Extract manufacturing year from text (title/description)
 * Looks for 4-digit years between 1950 and current year + 1
 */
function extractManufacturingYear(text) {
  if (!text || typeof text !== 'string') return null;
  
  // Match 4-digit years between 1950 and current year + 1
  // Match 4-digit years between 1950 and current year + 1
  const currentYear = new Date().getFullYear();
  const yearPattern = /\b(19[5-9]\d|20[0-4]\d)\b/g;
  const matches = text.match(yearPattern);
  
  if (matches && matches.length > 0) {
    // Get the most likely manufacturing year (usually the first or most recent valid year)
    const years = matches.map(y => parseInt(y)).filter(y => y >= 1950 && y <= currentYear + 1);
    if (years.length > 0) {
      // Return the highest year (most recent) as it's likely the manufacturing year
      return Math.max(...years);
    }
  }
  
  return null;
}

/**
 * Extract car brand from text (title/description)
 * Supports both English and Arabic car brand names
 */
function extractCarBrand(text) {
  if (!text || typeof text !== 'string') return null;
  
  const textLower = text.toLowerCase();
  const textNormalized = textLower.replace(/[^\w\s\u0600-\u06FF]/g, ' '); // Keep Arabic and English chars
  
  // Common car brands (English and Arabic)
  const carBrands = [
    // English brands
    { patterns: ['toyota', 'تويوتا'], name: 'Toyota' },
    { patterns: ['nissan', 'نيسان'], name: 'Nissan' },
    { patterns: ['honda', 'هوندا'], name: 'Honda' },
    { patterns: ['hyundai', 'هيونداي'], name: 'Hyundai' },
    { patterns: ['kia', 'كيا'], name: 'Kia' },
    { patterns: ['mazda', 'مازدا'], name: 'Mazda' },
    { patterns: ['mitsubishi', 'ميتسوبيشي'], name: 'Mitsubishi' },
    { patterns: ['suzuki', 'سوزوكي'], name: 'Suzuki' },
    { patterns: ['ford', 'فورد'], name: 'Ford' },
    { patterns: ['chevrolet', 'chev', 'شيفروليه', 'شيفر'], name: 'Chevrolet' },
    { patterns: ['bmw', 'بي ام دبليو', 'بى ام دبليو'], name: 'BMW' },
    { patterns: ['mercedes', 'mercedes-benz', 'مرسيدس', 'مرسيدس بنز'], name: 'Mercedes-Benz' },
    { patterns: ['audi', 'أودي', 'اودي'], name: 'Audi' },
    { patterns: ['volkswagen', 'vw', 'فولكس واجن', 'فولكس'], name: 'Volkswagen' },
    { patterns: ['peugeot', 'بيجو'], name: 'Peugeot' },
    { patterns: ['renault', 'رينو'], name: 'Renault' },
    { patterns: ['opel', 'أوبل', 'اوبل'], name: 'Opel' },
    { patterns: ['dodge', 'دودج'], name: 'Dodge' },
    { patterns: ['jeep', 'جيب'], name: 'Jeep' },
    { patterns: ['gmc', 'جي ام سي'], name: 'GMC' },
    { patterns: ['cadillac', 'كاديلاك'], name: 'Cadillac' },
    { patterns: ['lexus', 'لكزس'], name: 'Lexus' },
    { patterns: ['infiniti', 'انفينيتي'], name: 'Infiniti' },
    { patterns: ['acura', 'أكورا', 'اكورا'], name: 'Acura' },
    { patterns: ['volvo', 'فولفو'], name: 'Volvo' },
    { patterns: ['land rover', 'لاند روفر'], name: 'Land Rover' },
    { patterns: ['range rover', 'رينج روفر'], name: 'Range Rover' },
    { patterns: ['porsche', 'بورش'], name: 'Porsche' },
    { patterns: ['jaguar', 'جاكوار'], name: 'Jaguar' },
    { patterns: ['mini', 'ميني'], name: 'Mini' },
    { patterns: ['fiat', 'فيات'], name: 'Fiat' },
    { patterns: ['skoda', 'سكودا'], name: 'Skoda' },
    { patterns: ['seat', 'سيات'], name: 'SEAT' },
    { patterns: ['geely', 'جيلي'], name: 'Geely' },
    { patterns: ['mg', 'ام جي'], name: 'MG' },
    { patterns: ['changan', 'تشانجان'], name: 'Changan' },
    { patterns: ['haval', 'هافال'], name: 'Haval' },
    { patterns: ['chery', 'شيري'], name: 'Chery' },
    { patterns: ['great wall', 'جريت وول'], name: 'Great Wall' },
  ];
  
  // Check each brand
  for (const brand of carBrands) {
    for (const pattern of brand.patterns) {
      // Use word boundary for English, simple match for Arabic
      if (pattern.match(/[\u0600-\u06FF]/)) {
        // Arabic pattern - simple contains check
        if (textNormalized.includes(pattern.toLowerCase())) {
          return brand.name;
        }
      } else {
        // English pattern - use word boundary
        const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(text)) {
          return brand.name;
        }
      }
    }
  }
  
  return null;
}

/**
 * GET /api/ads/all
 * Query:
 *  - page=1
 *  - limit=500 (max 5000)
 *  - city=string (filter by city)
 *  - manufacturingYear=number (filter by manufacturing year)
 *  - carBrand=string (filter by car brand)
 *  - hasPrice=true/false (filter by price existence)
 *  - hasImages=true/false (filter by images existence)
 *  - hasContact=true/false (filter by contact existence)
 *  - search=string (search in title, description, authorName, city)
 */
async function getAllAds(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit || "500", 10) || 500;
    const limit = Math.min(Math.max(limitRaw, 1), 5000);

    // Build query filter
    const query = {};
    const andConditions = [];

    // City filter
    if (req.query.city) {
      query.city = req.query.city;
    }

    // Manufacturing Year filter - will be applied after extraction
    let manufacturingYearFilter = null;
    if (req.query.manufacturingYear) {
      const year = parseInt(req.query.manufacturingYear, 10);
      if (!isNaN(year) && year >= 1950) {
        manufacturingYearFilter = year;
      }
    }

    // Car Brand filter - will be applied after extraction
    let carBrandFilter = null;
    if (req.query.carBrand) {
      carBrandFilter = req.query.carBrand;
    }

    // If we have extraction-based filters, we need to load more items to filter properly
    // Otherwise pagination would filter after limiting, which is incorrect
    const needsExtractionFilter = manufacturingYearFilter !== null || carBrandFilter !== null;
    const effectiveLimit = needsExtractionFilter ? Math.max(limit * 10, 5000) : limit; // Load more when filtering

    // Price filter
    if (req.query.hasPrice === 'true') {
      query.price = { $exists: true, $ne: null, $gt: 0 };
    } else if (req.query.hasPrice === 'false') {
      andConditions.push({
        $or: [
          { price: { $exists: false } },
          { price: null },
          { price: { $lte: 0 } }
        ]
      });
    }

    // Images filter
    if (req.query.hasImages === 'true') {
      andConditions.push({
        $or: [
          { images: { $exists: true, $ne: null, $not: { $size: 0 } } },
          { $expr: { $gt: [{ $size: { $ifNull: ['$images', []] } }, 0] } }
        ]
      });
    } else if (req.query.hasImages === 'false') {
      andConditions.push({
        $or: [
          { images: { $exists: false } },
          { images: null },
          { images: [] },
          { $expr: { $eq: [{ $size: { $ifNull: ['$images', []] } }, 0] } }
        ]
      });
    }

    // Contact filter
    if (req.query.hasContact === 'true') {
      query['contact.phone'] = { $exists: true, $ne: null, $ne: '' };
    } else if (req.query.hasContact === 'false') {
      andConditions.push({
        $or: [
          { 'contact.phone': { $exists: false } },
          { 'contact.phone': null },
          { 'contact.phone': '' }
        ]
      });
    }

    // Search filter (search in multiple fields)
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      andConditions.push({
        $or: [
          { title: searchRegex },
          { description: searchRegex },
          { authorName: searchRegex },
          { city: searchRegex }
        ]
      });
    }

    // Combine all conditions
    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    const [items, total] = await Promise.all([
      Ad.find(query)
        .sort({ lastScrapedAt: -1 })
        .skip(needsExtractionFilter ? 0 : (page - 1) * limit) // Skip pagination if we need to filter
        .limit(needsExtractionFilter ? effectiveLimit : limit) // Load more if filtering
        .lean(),
      Ad.countDocuments(query),
    ]);

    // Debug: Log first item's raw structure to understand data format
    if (items.length > 0) {
      const firstItem = items[0];
      console.log('=== DEBUG: First Ad Item Structure ===');
      console.log('All keys:', Object.keys(firstItem));
      console.log('images field:', firstItem.images);
      console.log('images type:', typeof firstItem.images);
      console.log('images isArray:', Array.isArray(firstItem.images));
      if (Array.isArray(firstItem.images)) {
        console.log('images length:', firstItem.images.length);
        if (firstItem.images.length > 0) {
          console.log('First image item:', firstItem.images[0]);
          console.log('First image type:', typeof firstItem.images[0]);
        }
      }
      // Check for alternative field names
      const altFields = ['imageUrls', 'image_urls', 'imageList', 'photos', 'pictures', 'media', 'image', 'imageUrl'];
      altFields.forEach(field => {
        if (firstItem[field]) {
          console.log(`Found alternative field "${field}":`, firstItem[field]);
        }
      });
      console.log('=====================================');
    }

    // Extract manufacturing year and car brand, and ensure images field is properly formatted
    const itemsWithImages = items.map((item, index) => {
      // Extract manufacturing year from title
      const titleText = item.title || '';
      const descriptionText = item.description || '';
      const combinedText = `${titleText} ${descriptionText}`;
      
      item.manufacturingYear = extractManufacturingYear(combinedText);
      item.carBrand = extractCarBrand(combinedText) || extractCarBrand(titleText) || extractCarBrand(descriptionText);
      // Check for images in various possible field names
      let imagesArray = item.images;
      
      // If images is missing, check alternative field names
      if (!imagesArray || (Array.isArray(imagesArray) && imagesArray.length === 0)) {
        imagesArray = item.imageUrls || item.image_urls || item.imageList || item.photos || item.pictures || item.media || item.image || item.imageUrl || [];
      }
      
      // If images is missing or null, set it to empty array
      if (!imagesArray) {
        imagesArray = [];
      }
      
      // If images is not an array, try to convert it
      if (!Array.isArray(imagesArray)) {
        if (typeof imagesArray === 'string') {
          // Try to parse if it's a JSON string
          try {
            imagesArray = JSON.parse(imagesArray);
            if (!Array.isArray(imagesArray)) {
              imagesArray = [imagesArray];
            }
          } catch {
            // If parsing fails, treat as single URL string
            imagesArray = imagesArray.trim() ? [imagesArray] : [];
          }
        } else if (typeof imagesArray === 'object' && imagesArray !== null) {
          // Convert object to array
          imagesArray = [imagesArray];
        } else {
          imagesArray = [];
        }
      }
      
      // Process each image item to extract URLs
      const processedImages = [];
      for (const img of imagesArray) {
        if (typeof img === 'string' && img.trim()) {
          // Direct URL string - accept any non-empty string
          const trimmed = img.trim();
          if (trimmed) {
            // If it's a full URL, use it as-is
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
              processedImages.push(trimmed);
            } 
            // If it starts with //, it's a protocol-relative URL
            else if (trimmed.startsWith('//')) {
              processedImages.push('https:' + trimmed);
            }
            // If it starts with /, it might be a relative URL - try to construct full URL
            else if (trimmed.startsWith('/')) {
              // Try to construct full URL from haraj domain
              if (item.url) {
                try {
                  const baseUrl = new URL(item.url);
                  processedImages.push(new URL(trimmed, baseUrl.origin).href);
                } catch {
                  processedImages.push(trimmed);
                }
              } else {
                processedImages.push(trimmed);
              }
            }
            // Otherwise, assume it's a valid URL or path
            else {
              processedImages.push(trimmed);
            }
          }
        } else if (typeof img === 'object' && img !== null) {
          // Try to extract URL from object - prioritize originalUrl and cloudinaryUrl (Haraj format)
          // Check originalUrl first, then cloudinaryUrl, then other common properties
          const url = img.originalUrl || img.cloudinaryUrl || img.url || img.src || img.link || img.image || img.imageUrl || img.path || img.uri || img.href || img.original || img.full || img.thumbnail || img.value || img.data;
          if (url) {
            if (typeof url === 'string' && url.trim()) {
              const trimmed = url.trim();
              // Accept any string that looks like it could be a URL
              if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//') || trimmed.startsWith('/')) {
                if (trimmed.startsWith('//')) {
                  processedImages.push('https:' + trimmed);
                } else if (trimmed.startsWith('/') && item.url) {
                  try {
                    const baseUrl = new URL(item.url);
                    processedImages.push(new URL(trimmed, baseUrl.origin).href);
                  } catch {
                    processedImages.push(trimmed);
                  }
                } else {
                  processedImages.push(trimmed);
                }
              } else {
                // Even if it doesn't start with http, accept it (might be a valid path)
                processedImages.push(trimmed);
              }
            } else if (typeof url === 'object' && url !== null) {
              // Nested object, try to extract URL recursively
              const nestedUrl = url.originalUrl || url.cloudinaryUrl || url.url || url.src || url.link;
              if (nestedUrl && typeof nestedUrl === 'string' && nestedUrl.trim()) {
                processedImages.push(nestedUrl.trim());
              }
            }
          }
        }
      }
      
      item.images = processedImages;
      
      // Debug: Log first item's processed images
      if (index === 0 && processedImages.length > 0) {
        console.log('=== Processed Images (First Item) ===');
        console.log('Total processed images:', processedImages.length);
        console.log('First 3 image URLs:', processedImages.slice(0, 3));
        console.log('===================================');
      }
      
      return item;
    });

    // Apply manufacturing year and car brand filters after extraction
    let filteredItems = itemsWithImages;
    
    if (manufacturingYearFilter !== null) {
      filteredItems = filteredItems.filter(item => item.manufacturingYear === manufacturingYearFilter);
    }
    
    if (carBrandFilter !== null) {
      filteredItems = filteredItems.filter(item => 
        item.carBrand && item.carBrand.toLowerCase() === carBrandFilter.toLowerCase()
      );
    }

    // Recalculate total and pagination for filtered results
    let filteredTotal = total;
    let paginatedItems = filteredItems;
    
    if (needsExtractionFilter) {
      // When using extraction filters, we filtered all loaded items
      // We need to get the actual total count by loading all matching items
      // For now, we'll use the filtered count as an approximation
      // In production, you might want to store extracted values in DB for better performance
      filteredTotal = filteredItems.length;
      
      // Apply pagination to filtered items
      paginatedItems = filteredItems.slice((page - 1) * limit, page * limit);
    }

    return res.json({
      page,
      limit,
      total: filteredTotal,
      pages: Math.ceil(filteredTotal / limit),
      items: paginatedItems, // ✅ all fields with normalized images, manufacturingYear, and carBrand
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

module.exports = { getAllAds };
